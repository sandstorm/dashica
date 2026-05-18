package alerting

import (
	"os"
	"testing"

	"github.com/sandstorm/dashica/lib/clickhouse"
	"github.com/sandstorm/dashica/lib/config"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
	testServer "github.com/sandstorm/dashica/lib/testutil/testserver"
	"github.com/stretchr/testify/require"

	"github.com/rs/zerolog"
)

// TestAlertEvaluatorE2E tests with a real Clickhouse database
func TestAlertEvaluatorE2E(t *testing.T) {
	testServer.SetGoModuleAsWorkingDir(t)

	logger := zerolog.New(zerolog.ConsoleWriter{Out: os.Stderr})
	cfg, _ := testServer.LoadTestingConfig(t)
	clickhouseManager := clickhouse.NewManager(cfg, logger)
	timeProvider := config.NewVirtualTimeProvider()
	alertEvaluator := NewAlertEvaluator(logger, clickhouseManager, timeProvider)

	alertManager := NewAlertManager(cfg, logger, alertEvaluator, nil)
	alertManager.RegisterAlerts("test", NewAlert("shopOrderFailures1").
		Query(sql.New(
			sql.From("full_logs"),
			sql.Select(sql.Field("toStartOfFifteenMinutes(timestamp)::DateTime64").WithAlias("time")),
			sql.Select(sql.Field("toUnixTimestamp(time)").WithAlias("time_ts")),
			sql.Select(sql.Count().WithAlias("value")),
			sql.Where("event_dataset = 'shop_order_failures'"),
			sql.GroupBy(sql.Field("time")),
			sql.OrderBy(sql.Field("time ASC")),
		)).
		EvaluationFilter("toStartOfFifteenMinutes(timestamp) = toStartOfFifteenMinutes(toDateTime('2025-04-02 00:55:12'))").
		AlertWhenAbove(1000).
		Message("ERROR - too many failures").
		CheckEvery("@15minutes"),
	)

	testCases := []struct {
		name           string
		alertKey       string
		expectedResult AlertResult
		expectedError  bool
	}{
		{
			name:     "event_dataset=shop_order_failures 2025-04-02 - LOTS of errors between 00:00 and 04:00 UTC",
			alertKey: "shopOrderFailures1",
			expectedResult: AlertResult{
				State:   AlertStateError,
				Message: "ERROR - too many failures",
			},
			expectedError: false,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			def := alertManager.GetAlertDefinition(AlertId{Group: "test", Key: tc.alertKey})
			require.NotNil(t, def, "alert definition not found: %s", tc.alertKey)

			alertResult, err := alertEvaluator.EvaluateAlert(*def)

			if tc.expectedError {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
				require.Equal(t, tc.expectedResult.Message, alertResult.Message)
				require.Equal(t, tc.expectedResult.State, alertResult.State)
			}
		})
	}
}
