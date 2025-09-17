package alerting

import (
	"context"
	"fmt"

	"github.com/adhocore/gronx"
	"github.com/rs/zerolog"
	"github.com/sandstorm/dashica/server/clickhouse"
	"github.com/sandstorm/dashica/server/core"
	"github.com/sandstorm/dashica/server/util/logging"

	"strings"
	"time"
)

// BatchEvaluator is responsible for evaluating alerts for a batch of time points; required during development
// when re-evaluating loads of alerts at once with little overhead.
//
// It is NOT used during production runs where alerts are checked incrementally.
//
// It works as follows:
//
// ASSUMPTION: the alert query somehow *buckets* timestamps together (e.g. toStartOfHour() etc), and then
// does evaluation in these buckets. This is controlled in the alert.sql file via the header comment, containing
// f.e.:
//
//   - for monotonically increasing aggregations such as count(*), we can alert on the CURRENT bucket:
//     => "--BUCKET: toStartOfFifteenMinutes(--NOW--)"
//
//   - for aggregations which do NOT increase monotonically, f.e. average(), we cannot look at the current bucket,
//     because in an intermediate state it might fire, where with the full data it will not. Thus, we need to
//     look at the LAST FULL BUCKET (whose values won't change anymore):
//     => "--BUCKET: toStartOfFifteenMinutes(--NOW-- - INTERVAL 15 MINUTE)"
//
//     1. we calculate the Execution Timestamps between start and end via the Cron Library
//     2. for each execution timestamp, we calculate the corresponding Bucket based on the --BUCKET expression.
//     The result is the line in the result set we need to look at.
//     3. Now we can run our alert query, with a long time span, yielding many buckets. Then, we can
//     iterate the (execution timestamp, bucket) pairs outputted in step 2, ordered by execution timestamp.
//     for each bucket, we look into the corresponding row of the alert query result (if it exists), and trigger
//     alerting as usual, taking the execution timestamp as alert timestamp.
type BatchEvaluator struct {
	logger           zerolog.Logger
	alertManager     *AlertManager
	alertEvaluator   *AlertEvaluator
	alertResultStore *AlertResultStore
}

// NewBatchEvaluator creates a new batch evaluator
func NewBatchEvaluator(logger zerolog.Logger, alertManager *AlertManager) *BatchEvaluator {
	logger = logger.With().
		Str(logging.EventDataset, logging.EventDataset_Dashica_Alerting_BatchEvaluator).
		Logger()
	return &BatchEvaluator{
		logger:           logger,
		alertManager:     alertManager,
		alertEvaluator:   alertManager.alertEvaluator,
		alertResultStore: alertManager.alertResultStore,
	}
}

// ExecutionTimePoint represents a single point in time when an alert should be evaluated
type ExecutionTimePoint struct {
	ExecutionTime time.Time
	BucketTime    time.Time
}

func (e *BatchEvaluator) EvaluateAlerts(ctx context.Context, start time.Time, end time.Time) error {
	err := e.alertManager.DiscoverAlertDefinitions()
	if err != nil {
		return fmt.Errorf("discovering alert definitions: %w", err)
	}

	e.alertManager.mu.RLock()
	loadedAlertDefinitions := e.alertManager.loadedAlertDefinitions[:]
	e.alertManager.mu.RUnlock()

	for _, alertDefinition := range loadedAlertDefinitions {
		if err := e.EvaluateSingleAlert(ctx, start, end, alertDefinition); err != nil {
			return fmt.Errorf("batch evaluating alert %s: %w", alertDefinition.Id.String(), err)
		}
	}
	return nil
}

func (e *BatchEvaluator) EvaluateSingleAlert(ctx context.Context, start, end time.Time, alertDefinition AlertDefinition) error {
	executionTimes, err := e.calculateExecutionTimes(alertDefinition.CheckEvery, start, end)
	if err != nil {
		return err
	}
	e.logger.Debug().
		Times("executionTimes", executionTimes).
		Msg("times where alert should be evaluated")

	buckets, err := e.calculateBuckets(context.Background(), executionTimes, alertDefinition.QueryBucketExpression)
	if err != nil {
		return err
	}
	e.logger.Debug().
		Times("buckets", buckets).
		Msg("times where alert should be evaluated")

	err = e.evaluateAlertForTimePoints(context.Background(), executionTimes, buckets, alertDefinition)
	if err != nil {
		return err
	}

	return nil
}

// calculateExecutionTimes collects all evaluation timestamps between start and end based on the cron expression.
// returned times are all in UTC, no matter what time zones the start and end times are.
func (e *BatchEvaluator) calculateExecutionTimes(cronExpr string, start, end time.Time) ([]time.Time, error) {
	start = start.UTC()
	end = end.UTC()
	executionTimes := make([]time.Time, 0, 100)
	refTime := start

	for refTime.Before(end) {
		nextTime, err := gronx.NextTickAfter(cronExpr, refTime, false)
		if err != nil {
			return nil, fmt.Errorf("error when parsing cron-time: %q calculating next time after %s: %w", cronExpr, refTime, err)
		}

		// If next time exceeds the end time, we're done
		if nextTime.After(end) {
			break
		}

		executionTimes = append(executionTimes, nextTime.UTC())
		refTime = nextTime
	}

	return executionTimes, nil
}

const TO_BUCKET_INTERVAL_CONVERSION_TPL = `
SELECT
    -- first convert the input numbers (=unix timestamps) to native DateTime objects.
    input,
    toDateTime(input, 'UTC') as input_datetime,
    -- second, for each input_datetime, calculate the target bucket. 
    toUnixTimestamp(%s) AS target_bucket
FROM
    -- here, in the placeholder, the Unix Timestamps will be printed.
    (SELECT arrayJoin([%s]) AS input);
`

// calculateBuckets determines the corresponding bucket time for each execution time
// based on the bucket expression from the alert query
// when no error is returned, you get an ORDERED LIST of bucket timestamps,
// corresponding to executionTimes input (so they have the same length)
func (b *BatchEvaluator) calculateBuckets(ctx context.Context, executionTimes []time.Time, bucketExpression string) ([]time.Time, error) {
	if len(executionTimes) == 0 {
		return nil, nil
	}

	// Replace --NOW-- in the bucket expression with the ClickHouse input_datetime reference
	bucketExpr := strings.ReplaceAll(bucketExpression, "--NOW--", "input_datetime")

	// Build the ClickHouse query to calculate buckets for all execution times
	executionTimesTs := make([]string, 0, len(executionTimes))
	for _, t := range executionTimes {
		executionTimesTs = append(executionTimesTs, fmt.Sprintf("%d", t.Unix()))
	}

	query := fmt.Sprintf(TO_BUCKET_INTERVAL_CONVERSION_TPL, bucketExpr, strings.Join(executionTimesTs, ", "))

	// Execute the query to get the bucket timestamps for each execution time
	type bucketMapping struct {
		Input        int64 `json:"input"`
		TargetBucket int64 `json:"target_bucket"`
	}

	clickhouseClient := b.alertResultStore.ClickhouseClient()
	result, err := clickhouse.QueryJSON[bucketMapping](ctx, clickhouseClient, query, clickhouse.DefaultQueryOptions())
	if err != nil {
		return nil, fmt.Errorf("calculating bucket timestamps: %w", err)
	}

	buckets := make([]time.Time, 0, len(result.Data))
	for i, row := range result.Data {
		if executionTimes[i].Unix() != row.Input {
			// this error hints that we built the query in a wrong way.
			return nil, fmt.Errorf("invariant Violation - row %d input is not the one we expect: expected %d, got %d", i, executionTimes[i].Unix(), row.Input)
		}
		buckets = append(buckets, time.Unix(row.TargetBucket, 0).UTC())
	}

	return buckets, nil
}

// evaluateAlertForTimePoints runs the alert query for the given time span and evaluates each result
func (b *BatchEvaluator) evaluateAlertForTimePoints(ctx context.Context, executionTimes, buckets []time.Time, alertDefinition AlertDefinition) error {
	if len(executionTimes) == 0 {
		return nil
	}

	clickhouseClient, err := b.alertEvaluator.clickhouseManager.GetClientForSqlFile(alertDefinition.QueryPath)
	if err != nil {
		return fmt.Errorf("loading clickhouse client for %s: %w", alertDefinition.QueryPath, err)
	}

	queryOpts := clickhouse.DefaultQueryOptions()
	queryOpts.Parameters = alertDefinition.Params

	// DIFFERENCE to regular AlertEvaluator: There, we execute the query in a way that only ONE row is returned;
	// here, we return the full result set as we want to execute a batch query.
	// TODO: coarse timestamp selection.
	resultset, err := clickhouse.QueryJSON[alertResultRow](context.Background(), clickhouseClient, alertDefinition.Query, queryOpts)
	if err != nil {
		return fmt.Errorf("running batch alert SQL query: %w", err)
	}

	// Process each execution time point
	for i, executionTime := range executionTimes {
		// find the corresponding bucket timestamp for each execution time
		bucket := buckets[i]

		// find the result for this bucket in the resultset (or 0)
		resultsetRow := findResultsetRowWithBucket(resultset.Data, bucket)

		alertResult, err := b.alertEvaluator.evaluateThreshold(alertDefinition, resultsetRow)
		if err != nil {
			fmt.Errorf("evaluating resultset row: %w", err)
		}
		// Persist the result with the timestamp from the execution time
		alertResult.Timestamp = core.Time(executionTime)

		err = b.alertResultStore.PersistResultAndNotifyIfChanged(alertDefinition.Id, alertResult, noNotification)
		if err != nil {
			return fmt.Errorf("persisting alert result: %w", err)
		}
	}

	return nil
}

func findResultsetRowWithBucket(results []alertResultRow, bucket time.Time) []alertResultRow {
	for i, result := range results {
		if result.TimeTs == bucket.Unix() {
			return results[i : i+1]
		}
	}
	// Empty slice
	return results[0:0]
}
