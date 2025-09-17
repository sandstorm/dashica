package alerting

import (
	"context"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"

	"github.com/adhocore/gronx/pkg/tasker"
	"github.com/rs/zerolog"
	"github.com/sandstorm/dashica/server/core"
	"github.com/sandstorm/dashica/server/util/logging"
)

type AlertManager struct {
	config           *core.AppConfig
	logger           zerolog.Logger
	fileSystem       fs.FS
	alertEvaluator   *AlertEvaluator
	alertResultStore *AlertResultStore
	// alertDefinitionPattern is not configurable from userland, but helpful for overriding during tests.
	alertDefinitionPattern string

	// mutex protecting LoadedAlertsDefinition
	mu                     sync.RWMutex
	loadedAlertDefinitions []AlertDefinition
}

func NewAlertManager(config *core.AppConfig, logger zerolog.Logger, fileSystem fs.FS, alertEvaluator *AlertEvaluator, alertResultStore *AlertResultStore) *AlertManager {
	logger = logger.With().
		Str(logging.EventDataset, logging.EventDataset_Dashica_Alerting_Manager).
		Logger()

	return &AlertManager{
		config:                 config,
		logger:                 logger,
		fileSystem:             fileSystem,
		alertEvaluator:         alertEvaluator,
		alertResultStore:       alertResultStore,
		alertDefinitionPattern: "client/content/*/alerts.yaml",
	}
}

func (a *AlertManager) DiscoverAlertDefinitions() error {
	alertYamlFiles, err := fs.Glob(a.fileSystem, a.alertDefinitionPattern)
	if err != nil {
		return fmt.Errorf("scanning for alert configuration files: %w", err)
	}

	a.logger.Debug().
		Strs("alertYamlFiles", alertYamlFiles).
		Msg("Discovered Alert SQL files. Parsing...")

	fullAlertDefinitions := make([]AlertDefinition, 0, 50)
	for _, filePath := range alertYamlFiles {
		alertDefinitions, err := ParseAlertConfiguration(a.fileSystem, filePath)
		if err != nil {
			return fmt.Errorf("processing %s: %w", filePath, err)
		}
		fullAlertDefinitions = append(fullAlertDefinitions, alertDefinitions...)
	}

	a.logger.Debug().
		Dict("alertDefinitions", zerolog.Dict().
			Fields(fullAlertDefinitions)).
		Msg("loaded alert definitions")

	a.mu.Lock()
	defer a.mu.Unlock()
	a.loadedAlertDefinitions = fullAlertDefinitions

	return nil
}

func (a *AlertManager) GetAlertDefinition(id AlertId) *AlertDefinition {
	a.mu.RLock()
	loadedAlertDefinitions := a.loadedAlertDefinitions[:]
	a.mu.RUnlock()
	for _, alertDefinition := range loadedAlertDefinitions {
		if alertDefinition.Id == id {
			return &alertDefinition
		}
	}
	return nil
}

func (a *AlertManager) RunAlertScheduler() error {
	a.mu.RLock()
	loadedAlertDefinitions := a.loadedAlertDefinitions[:]
	a.mu.RUnlock()

	taskr := tasker.New(tasker.Option{
		Verbose: true,
	})
	// log taskr logs via Zerolog
	taskr.Log = log.New(a.logger, "", log.LstdFlags)

	err := a.alertResultStore.LoadAlertStatusIntoMemory()
	if err != nil {
		return fmt.Errorf("loading alert status into memory: %w", err)
	}

	if len(loadedAlertDefinitions) == 0 {
		// no alerts, nothing needs to be done
		return nil
	}
	for _, alertDefinition := range loadedAlertDefinitions {
		// on startup, evaluate all alerts once; and if needed, also send notifications
		{
			alertResult, err := a.alertEvaluator.EvaluateAlert(alertDefinition)
			if err != nil {
				return fmt.Errorf("evaluating alert %s: %w", alertDefinition.Id.String(), err)
			}
			err = a.alertResultStore.PersistResultAndNotifyIfChanged(alertDefinition.Id, alertResult, func() error {
				return a.notifyAlertChange(alertDefinition, alertResult)
			})
			if err != nil {
				return fmt.Errorf("persisting alert result %s: %w", alertDefinition.Id.String(), err)
			}
		}

		taskr.Task(alertDefinition.CheckEvery, func(ctx context.Context) (int, error) {
			alertResult, err := a.alertEvaluator.EvaluateAlert(alertDefinition)
			if err != nil {
				return 1, fmt.Errorf("evaluating alert %s: %w", alertDefinition.Id.String(), err)
			}
			err = a.alertResultStore.PersistResultAndNotifyIfChanged(alertDefinition.Id, alertResult, func() error {
				return a.notifyAlertChange(alertDefinition, alertResult)
			})
			if err != nil {
				return 1, fmt.Errorf("persisting alert result and notifying %s: %w", alertDefinition.Id.String(), err)
			}
			// then return exit code and error, for eg: if everything okay
			return 0, nil
		})
	}

	taskr.Run()
	return nil
}

func (a *AlertManager) notifyAlertChange(alertDefinition AlertDefinition, alertResult *AlertResult) error {
	if a.config.Alerting.HelvetikitAlertingUrl == "" {
		a.logger.Warn().Msg("No Helvetikit server found; will not trigger alert")
		return nil
	}

	formBody := url.Values{}
	formBody.Add("group", "dashica_"+a.config.Alerting.HelvetikitIdGroup)
	formBody.Add("id", alertDefinition.Id.String())

	if alertResult.State == AlertStateOk {
		formBody.Add("state", "NORMAL")
	} else if alertResult.State == AlertStateWarn {
		formBody.Add("state", "WARNING")
	} else {
		formBody.Add("state", "ERROR")
	}

	formBody.Add("message", alertResult.Message)
	if alertDefinition.SlackChannel != "" {
		formBody.Add("slack_channel", alertDefinition.SlackChannel)
	}

	// TODO: deduplication_mode=NO for alerting on individual log lines

	resp, err := http.Post(a.config.Alerting.HelvetikitAlertingUrl, "application/x-www-form-urlencoded", strings.NewReader(formBody.Encode()))
	if err != nil {
		return fmt.Errorf("failed to send request: %w", err)
	}
	defer func(Body io.ReadCloser) {
		_ = Body.Close()
	}(resp.Body)

	if resp.StatusCode != http.StatusOK {
		body, readErr := io.ReadAll(resp.Body)
		if readErr != nil {
			return fmt.Errorf("request failed with status %d and error reading body: %w",
				resp.StatusCode, readErr)
		}
		return fmt.Errorf("request failed with status %d: %s", resp.StatusCode, string(body))
	}

	return nil

}

func noNotification() error {
	return nil
}
