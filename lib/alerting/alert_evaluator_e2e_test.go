package alerting

import (
	"os"
	"testing"

	"github.com/sandstorm/dashica/lib/clickhouse"
	"github.com/sandstorm/dashica/lib/config"
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

	alertManager := NewAlertManager(cfg, logger, os.DirFS("."), alertEvaluator, nil)
	alertManager.alertDefinitionPattern = "alerting/test_fixtures/alert_evaluator_e2e_alerts.yaml"
	err := alertManager.DiscoverAlertDefinitions()
	if err != nil {
		t.Fatalf("DiscoverAlertDefinitions: %s", err)
	}

	testCases := []struct {
		name            string
		now             string
		alertDefinition AlertDefinition
		expectedResult  AlertResult
		expectedError   bool
	}{
		{
			name:            "event_dataset=shop_order_failures 2025-04-02 - LOTS of errors between 00:00 and 04:00 UTC",
			now:             "2025-04-02 00:55:12",
			alertDefinition: findAlertDefinition(t, "shopOrderFailures1", alertManager.loadedAlertDefinitions),
			expectedResult: AlertResult{
				State:   AlertStateError,
				Message: "ERROR - too many failures",
			},
			expectedError: false,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			require.NoError(t, timeProvider.SetTime(tc.now))
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

func findAlertDefinition(t *testing.T, key string, definitions []AlertDefinition) AlertDefinition {
	for _, definition := range definitions {
		if definition.Id.Key == key {
			return definition
		}
	}

	t.Fatalf("did not find definition '%s'", key)
	return AlertDefinition{}
}
