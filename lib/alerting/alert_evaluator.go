package alerting

import (
	"context"
	"fmt"
	"strings"

	"github.com/rs/zerolog"
	"github.com/sandstorm/dashica/lib/clickhouse"
	"github.com/sandstorm/dashica/lib/config"
	"github.com/sandstorm/dashica/lib/logging"
)

// AlertEvaluator runs an alert's query and compares its row with the alert's condition (EvaluateAlert), at the time
// its TimeProvider says.
type AlertEvaluator struct {
	logger            zerolog.Logger
	clickhouseManager *clickhouse.ClientManager
	timeProvider      config.TimeProvider
}

func NewAlertEvaluator(logger zerolog.Logger, clickhouseManager *clickhouse.ClientManager, timeProvider config.TimeProvider) *AlertEvaluator {
	logger = logger.With().
		Str(logging.EventDataset, logging.EventDataset_Dashica_Alerting_Evaluator).
		Logger()
	return &AlertEvaluator{
		logger:            logger,
		clickhouseManager: clickhouseManager,
		timeProvider:      timeProvider,
	}
}

func (e AlertEvaluator) EvaluateAlert(definition AlertDefinition) (*AlertResult, error) {
	clickhouseClient, err := e.clickhouseManager.GetClient("default")
	if err != nil {
		return nil, fmt.Errorf("loading clickhouse client for %s: %w", definition.QueryPath, err)
	}

	alertSql := preprocessSql(definition, e.timeProvider)
	queryOpts := clickhouse.DefaultQueryOptions()
	queryOpts.Parameters = definition.Params

	resultset, err := clickhouse.QueryJSON[alertResultRow](context.Background(), clickhouseClient, alertSql, queryOpts)
	if err != nil {
		return nil, fmt.Errorf("running alert SQL query: %w", err)
	}

	return e.evaluateThreshold(definition, resultset.Data)
}

func (e AlertEvaluator) WithTimeProvider(timeProvider config.TimeProvider) *AlertEvaluator {
	return &AlertEvaluator{
		logger:            e.logger,
		clickhouseManager: e.clickhouseManager,
		timeProvider:      timeProvider,
	}
}

// AlertState is what an evaluated alert says; its String() is stored as the status in dashica_alert_events.
//
//dashicagen:enum
type AlertState struct{ v string }

var (
	AlertStateError = AlertState{"error"}
	AlertStateWarn  = AlertState{"warn"}
	AlertStateOk    = AlertState{"OK"}
)

type AlertResult struct {
	State   AlertState
	Message string

	// Execution Timestamp
	Timestamp config.Time
}

// alertResultRow describes the alert result format from the database to the alerter (i.e. the supported result set)
type alertResultRow struct {
	TimeTs int64   `json:"time_ts"`
	Value  float64 `json:"value"`
	// TODO: IMPL ME
	AlertIfValueGt *float64 `json:"alert_if_value_gt,omitempty"`
	// TODO: IMPL ME
	AlertIfValueLt *float64 `json:"alert_if_value_lt"`
}

func (a alertResultRow) MarshalZerologObject(e *zerolog.Event) {
	e.Float64("value", a.Value)
	if a.AlertIfValueGt != nil {
		e.Float64("alert_if_value_gt", *a.AlertIfValueGt)
	}
	if a.AlertIfValueLt != nil {
		e.Float64("alert_if_value_lt", *a.AlertIfValueLt)
	}
}

type alertResultRows []alertResultRow

func (ar alertResultRows) MarshalZerologArray(a *zerolog.Array) {
	for _, row := range ar {
		a.Object(row)
	}
}

// evaluateThreshold evaluates the alert threshold for a SINGLE alert row (i.e. a specific timestamp).
// data usually contains 0 or 1 row; and the depending on the AlertIf condition configured throws errors if
// it contains more than 1 row.
func (e AlertEvaluator) evaluateThreshold(definition AlertDefinition, data []alertResultRow) (*AlertResult, error) {
	var results alertResultRows = data

	e.logger.Debug().
		Str("alertDefinition", definition.Id.String()).
		Str("sqlPath", definition.QueryPath).
		//Str("clickhouseClientId", clickhouseClient.Id).
		Str("currentTime", e.timeProvider.NowSqlString()).
		Array("results", results).
		Msg("received result set")

	if definition.AlertIf.ValueGt != nil {
		return e.zeroOrSingleRowWithTimestamp(data, func(value float64) AlertResult {
			if value > *definition.AlertIf.ValueGt {
				return AlertResult{
					State:   AlertStateError,
					Message: definition.Message,
				}
			} else {
				return AlertResult{
					State: AlertStateOk,
				}
			}
		}), nil
	}

	if definition.AlertIf.ValueLt != nil {
		return e.zeroOrSingleRowWithTimestamp(data, func(value float64) AlertResult {
			if value < *definition.AlertIf.ValueLt {
				return AlertResult{
					State:   AlertStateError,
					Message: definition.Message,
				}
			} else {
				return AlertResult{
					State: AlertStateOk,
				}
			}
		}), nil
	}

	return &AlertResult{
		State:   AlertStateError,
		Message: "INTERNAL ERROR: no alert_if condition found.",
	}, nil
}

func (e AlertEvaluator) zeroOrSingleRowWithTimestamp(resultRows []alertResultRow, resultFn func(value float64) AlertResult) *AlertResult {
	value := 0.0
	if len(resultRows) == 1 {
		value = resultRows[0].Value
	} else if len(resultRows) > 1 {
		return e.withTimestamp(&AlertResult{
			State:   AlertStateError,
			Message: fmt.Sprintf("QUERY ERROR: found %d result rows, but only 0 or 1 allowed", len(resultRows)),
		})
	}

	alertResult := resultFn(value)
	if alertResult.State == (AlertState{}) {
		return e.withTimestamp(&AlertResult{
			State:   AlertStateError,
			Message: "INTERNAL ERROR: no alert state evaluated",
		})
	}

	return e.withTimestamp(&alertResult)
}

func (e AlertEvaluator) withTimestamp(a *AlertResult) *AlertResult {
	a.Timestamp = e.timeProvider.Now()
	return a
}

func preprocessSql(alertDefinition AlertDefinition, timeProvider config.TimeProvider) string {
	bucket := strings.ReplaceAll(alertDefinition.QueryBucketExpression, "--NOW--", timeProvider.NowSqlString())

	sql := alertDefinition.Query
	sql = strings.ReplaceAll(sql, "--HAVING--", "HAVING")
	sql = strings.ReplaceAll(sql, "--BUCKET--", bucket)

	return sql
}
