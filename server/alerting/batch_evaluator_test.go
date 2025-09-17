package alerting

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/rs/zerolog"
	"github.com/sandstorm/dashica/server/clickhouse"
	testServer "github.com/sandstorm/dashica/server/test-utils/test-server"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBatchEvaluator_CalculateExecutionTimes(t *testing.T) {
	logger := zerolog.New(zerolog.ConsoleWriter{Out: os.Stderr})

	// Create minimal dependencies to initialize BatchEvaluator
	alertManager := &AlertManager{}
	batchEvaluator := NewBatchEvaluator(logger, alertManager)

	// Define test cases with various time zones and cron expressions
	testCases := []struct {
		name       string
		cronExpr   string
		start      time.Time
		end        time.Time
		expected   []time.Time
		shouldFail bool
	}{
		{
			name:     "Every minute for 10 minutes UTC",
			cronExpr: "* * * * *",
			start:    time.Date(2023, 1, 1, 10, 0, 0, 0, time.UTC),
			end:      time.Date(2023, 1, 1, 10, 10, 0, 0, time.UTC),
			expected: []time.Time{
				time.Date(2023, 1, 1, 10, 1, 0, 0, time.UTC),
				time.Date(2023, 1, 1, 10, 2, 0, 0, time.UTC),
				time.Date(2023, 1, 1, 10, 3, 0, 0, time.UTC),
				time.Date(2023, 1, 1, 10, 4, 0, 0, time.UTC),
				time.Date(2023, 1, 1, 10, 5, 0, 0, time.UTC),
				time.Date(2023, 1, 1, 10, 6, 0, 0, time.UTC),
				time.Date(2023, 1, 1, 10, 7, 0, 0, time.UTC),
				time.Date(2023, 1, 1, 10, 8, 0, 0, time.UTC),
				time.Date(2023, 1, 1, 10, 9, 0, 0, time.UTC),
				time.Date(2023, 1, 1, 10, 10, 0, 0, time.UTC),
			},
			shouldFail: false,
		},
		{
			name:     "Every 5 minutes in different time zones",
			cronExpr: "*/5 * * * *",
			start:    time.Date(2023, 1, 1, 10, 0, 0, 0, time.FixedZone("EST", -5*60*60)), // EST timezone
			end:      time.Date(2023, 1, 1, 18, 0, 0, 0, time.FixedZone("CET", 1*60*60)),  // CET timezone
			expected: []time.Time{
				time.Date(2023, 1, 1, 15, 5, 0, 0, time.UTC),  // 10:05 EST = 15:05 UTC
				time.Date(2023, 1, 1, 15, 10, 0, 0, time.UTC), // 10:10 EST = 15:10 UTC
				time.Date(2023, 1, 1, 15, 15, 0, 0, time.UTC),
				time.Date(2023, 1, 1, 15, 20, 0, 0, time.UTC),
				time.Date(2023, 1, 1, 15, 25, 0, 0, time.UTC),
				time.Date(2023, 1, 1, 15, 30, 0, 0, time.UTC),
				time.Date(2023, 1, 1, 15, 35, 0, 0, time.UTC),
				time.Date(2023, 1, 1, 15, 40, 0, 0, time.UTC),
				time.Date(2023, 1, 1, 15, 45, 0, 0, time.UTC),
				time.Date(2023, 1, 1, 15, 50, 0, 0, time.UTC),
				time.Date(2023, 1, 1, 15, 55, 0, 0, time.UTC),
				time.Date(2023, 1, 1, 16, 0, 0, 0, time.UTC), // 11:00 EST = 16:00 UTC
				time.Date(2023, 1, 1, 16, 5, 0, 0, time.UTC), // Moving to next hour
				time.Date(2023, 1, 1, 16, 10, 0, 0, time.UTC),
				time.Date(2023, 1, 1, 16, 15, 0, 0, time.UTC),
				time.Date(2023, 1, 1, 16, 20, 0, 0, time.UTC),
				time.Date(2023, 1, 1, 16, 25, 0, 0, time.UTC),
				time.Date(2023, 1, 1, 16, 30, 0, 0, time.UTC),
				time.Date(2023, 1, 1, 16, 35, 0, 0, time.UTC),
				time.Date(2023, 1, 1, 16, 40, 0, 0, time.UTC),
				time.Date(2023, 1, 1, 16, 45, 0, 0, time.UTC),
				time.Date(2023, 1, 1, 16, 50, 0, 0, time.UTC),
				time.Date(2023, 1, 1, 16, 55, 0, 0, time.UTC),
				time.Date(2023, 1, 1, 17, 00, 0, 0, time.UTC), // 18:00 CET = 17:00 UTC
			},
			shouldFail: false,
		},
		{
			name:     "Hourly for a day crossing midnight",
			cronExpr: "0 * * * *",
			start:    time.Date(2023, 1, 1, 22, 0, 0, 0, time.UTC),
			end:      time.Date(2023, 1, 2, 2, 0, 0, 0, time.UTC),
			expected: []time.Time{
				time.Date(2023, 1, 1, 23, 0, 0, 0, time.UTC),
				time.Date(2023, 1, 2, 0, 0, 0, 0, time.UTC),
				time.Date(2023, 1, 2, 1, 0, 0, 0, time.UTC),
				time.Date(2023, 1, 2, 2, 0, 0, 0, time.UTC),
			},
			shouldFail: false,
		},
		{
			name:     "Complex cron expression",
			cronExpr: "15,45 */2 * * *", // At minute 15 and 45 past every 2nd hour
			start:    time.Date(2023, 1, 1, 8, 0, 0, 0, time.UTC),
			end:      time.Date(2023, 1, 1, 14, 0, 0, 0, time.UTC),
			expected: []time.Time{
				time.Date(2023, 1, 1, 8, 15, 0, 0, time.UTC),
				time.Date(2023, 1, 1, 8, 45, 0, 0, time.UTC),
				time.Date(2023, 1, 1, 10, 15, 0, 0, time.UTC),
				time.Date(2023, 1, 1, 10, 45, 0, 0, time.UTC),
				time.Date(2023, 1, 1, 12, 15, 0, 0, time.UTC),
				time.Date(2023, 1, 1, 12, 45, 0, 0, time.UTC),
			},
			shouldFail: false,
		},
		{
			name:       "Start time equals end time",
			cronExpr:   "* * * * *",
			start:      time.Date(2023, 1, 1, 10, 0, 0, 0, time.UTC),
			end:        time.Date(2023, 1, 1, 10, 0, 0, 0, time.UTC),
			expected:   []time.Time{},
			shouldFail: false,
		},
		{
			name:       "Start time after end time",
			cronExpr:   "* * * * *",
			start:      time.Date(2023, 1, 1, 11, 0, 0, 0, time.UTC),
			end:        time.Date(2023, 1, 1, 10, 0, 0, 0, time.UTC),
			expected:   []time.Time{},
			shouldFail: false,
		},
		{
			name:       "Invalid cron expression",
			cronExpr:   "invalid * * * *",
			start:      time.Date(2023, 1, 1, 10, 0, 0, 0, time.UTC),
			end:        time.Date(2023, 1, 1, 11, 0, 0, 0, time.UTC),
			expected:   nil,
			shouldFail: true,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			executionTimes, err := batchEvaluator.calculateExecutionTimes(tc.cronExpr, tc.start, tc.end)

			if tc.shouldFail {
				require.Error(t, err)
			} else {
				require.NoError(t, err)

				// Check if the calculated times match the expected times
				assert.Equal(t, len(tc.expected), len(executionTimes),
					"Number of execution times doesn't match expected: got %d, want %d",
					len(executionTimes), len(tc.expected))

				// Check each time individually
				for i, expectedTime := range tc.expected {
					if i < len(executionTimes) {
						assert.Equal(t, expectedTime, executionTimes[i],
							"TimeTs at index %d doesn't match: got %v, want %v",
							i, executionTimes[i], expectedTime)
					}
				}
			}
		})
	}
}

// TestBucketCalculation tests the functionality of calculating bucket timestamps
// based on execution timestamps and the --BUCKET expression.
func TestBatchEvaluator_BucketCalculation(t *testing.T) {
	logger := zerolog.New(zerolog.ConsoleWriter{Out: os.Stderr})

	// Create minimal dependencies to initialize BatchEvaluator
	config, _ := testServer.LoadTestingConfig(t)
	clickhouseManager := clickhouse.NewManager(config, logger)
	clickhouseClient, err := clickhouseManager.GetClient("alert_storage")
	require.NoError(t, err)
	alertResultStore := NewAlertResultStore(logger, clickhouseClient)

	batchEvaluator := NewBatchEvaluator(logger, &AlertManager{alertResultStore: alertResultStore})

	// Define test cases with different bucket expressions
	testCases := []struct {
		name            string
		bucketExpr      string
		execTimestamps  []time.Time
		expectedBuckets []time.Time
	}{
		{
			name:       "Current Fifteen Minute Bucket",
			bucketExpr: "toStartOfFifteenMinutes(--NOW--)",
			execTimestamps: []time.Time{
				time.Date(2023, 8, 15, 10, 14, 30, 0, time.UTC),
				time.Date(2023, 8, 15, 10, 17, 45, 0, time.UTC),
				time.Date(2023, 8, 15, 10, 31, 20, 0, time.UTC),
				time.Date(2023, 8, 15, 10, 44, 20, 0, time.UTC),
			},
			expectedBuckets: []time.Time{
				time.Date(2023, 8, 15, 10, 0, 0, 0, time.UTC),
				time.Date(2023, 8, 15, 10, 15, 0, 0, time.UTC),
				time.Date(2023, 8, 15, 10, 30, 0, 0, time.UTC),
				time.Date(2023, 8, 15, 10, 30, 0, 0, time.UTC),
			},
		},
		{
			name:       "Previous Fifteen Minute Bucket",
			bucketExpr: "toStartOfFifteenMinutes(--NOW-- - INTERVAL 15 MINUTE)",
			execTimestamps: []time.Time{
				time.Date(2023, 8, 15, 10, 14, 30, 0, time.UTC),
				time.Date(2023, 8, 15, 10, 17, 45, 0, time.UTC),
				time.Date(2023, 8, 15, 10, 31, 20, 0, time.UTC),
			},
			expectedBuckets: []time.Time{
				time.Date(2023, 8, 15, 9, 45, 0, 0, time.UTC),
				time.Date(2023, 8, 15, 10, 0, 0, 0, time.UTC),
				time.Date(2023, 8, 15, 10, 15, 0, 0, time.UTC),
			},
		},
		{
			name:       "Current Hour Bucket",
			bucketExpr: "toStartOfHour(--NOW--)",
			execTimestamps: []time.Time{
				time.Date(2023, 8, 15, 10, 14, 30, 0, time.UTC),
				time.Date(2023, 8, 15, 10, 59, 59, 0, time.UTC),
				time.Date(2023, 8, 15, 11, 0, 1, 0, time.UTC),
			},
			expectedBuckets: []time.Time{
				time.Date(2023, 8, 15, 10, 0, 0, 0, time.UTC),
				time.Date(2023, 8, 15, 10, 0, 0, 0, time.UTC),
				time.Date(2023, 8, 15, 11, 0, 0, 0, time.UTC),
			},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// For each execution timestamp, calculate the corresponding bucket
			buckets, err := batchEvaluator.calculateBuckets(context.Background(), tc.execTimestamps, tc.bucketExpr)
			require.NoError(t, err, "Failed to execute bucket calculation")

			assert.Equal(t, len(tc.expectedBuckets), len(tc.execTimestamps),
				"len(expectedBuckets) == len(execTimestamps) violated: got %d, %d - this indicates a broken test setup",
				len(tc.expectedBuckets), len(tc.expectedBuckets))

			assert.Equal(t, len(tc.expectedBuckets), len(buckets),
				"expected %d buckets, got %d",
				len(tc.expectedBuckets), len(buckets))

			// Check each time individually
			for i, expectedBucket := range tc.expectedBuckets {
				assert.Equal(t, expectedBucket, buckets[i],
					"TimeTs at index %d doesn't match: got %v, want %v",
					i, buckets[i], expectedBucket)
			}
		})
	}
}
