package alerting

import (
	"os"
	"testing"

	"github.com/sandstorm/dashica/server/clickhouse"
	"github.com/sandstorm/dashica/server/core"
	testServer "github.com/sandstorm/dashica/server/test-utils/test-server"
	"github.com/stretchr/testify/require"

	"github.com/rs/zerolog"
)

// TestAlertEvaluator tests with a real ClickHouse database
func TestAlertEvaluatorSimple(t *testing.T) {
	logger := zerolog.New(zerolog.ConsoleWriter{Out: os.Stderr})
	config, _ := testServer.LoadTestingConfig(t)
	clickhouseManager := clickhouse.NewManager(config, logger)
	alertEvaluator := NewAlertEvaluator(logger, clickhouseManager, core.NewVirtualTimeProvider())

	testCases := []struct {
		name            string
		alertDefinition AlertDefinition
		expectedResult  AlertResult
		expectedError   bool
	}{
		{
			name: "SIMPLE - Query with error",
			alertDefinition: AlertDefinition{
				Query: `SELECT invalid_syntax`,
			},
			expectedResult: AlertResult{
				State: AlertStateError,
			},
			expectedError: true,
		},
		{
			name: "SIMPLE - ValueGt alert - above threshold",
			alertDefinition: AlertDefinition{
				Query: `SELECT 15 as value`,
				AlertIf: AlertCondition{
					ValueGt: f64Ptr(10),
				},
				Message: "Value too high",
			},
			expectedResult: AlertResult{
				State:   AlertStateError,
				Message: "Value too high",
			},
			expectedError: false,
		},
		{
			name: "SIMPLE - ValueGt alert - below threshold",
			alertDefinition: AlertDefinition{
				Query: `SELECT 5 as value`,
				AlertIf: AlertCondition{
					ValueGt: f64Ptr(10),
				},
				Message: "Value too high",
			},
			expectedResult: AlertResult{
				State:   AlertStateOk,
				Message: "",
			},
			expectedError: false,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			alertResult, err := alertEvaluator.EvaluateAlert(tc.alertDefinition)

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

func f64Ptr(in float64) *float64 {
	return &in
}
