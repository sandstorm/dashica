package alerting

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"

	"github.com/adhocore/gronx/pkg/tasker"
	"github.com/rs/zerolog"
	"github.com/sandstorm/dashica/lib/config"
	"github.com/sandstorm/dashica/lib/logging"
)

type AlertManager struct {
	config           *config.Config
	logger           zerolog.Logger
	alertEvaluator   *AlertEvaluator
	alertResultStore *AlertResultStore

	mu               sync.RWMutex
	alertDefinitions []AlertDefinition
}

func NewAlertManager(config *config.Config, logger zerolog.Logger, alertEvaluator *AlertEvaluator, alertResultStore *AlertResultStore) *AlertManager {
	logger = logger.With().
		Str(logging.EventDataset, logging.EventDataset_Dashica_Alerting_Manager).
		Logger()

	return &AlertManager{
		config:           config,
		logger:           logger,
		alertEvaluator:   alertEvaluator,
		alertResultStore: alertResultStore,
	}
}

// RegisterAlerts registers Go-code-configured alerts before the scheduler starts.
func (a *AlertManager) RegisterAlerts(group string, alerts ...*Alert) {
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, alert := range alerts {
		a.alertDefinitions = append(a.alertDefinitions, alert.ToDefinition(group))
	}
}

// allDefinitions returns all registered alert definitions. Must be called with mu held.
func (a *AlertManager) allDefinitions() []AlertDefinition {
	return a.alertDefinitions
}

func (a *AlertManager) GetAlertDefinition(id AlertId) *AlertDefinition {
	a.mu.RLock()
	all := a.allDefinitions()
	a.mu.RUnlock()
	for _, alertDefinition := range all {
		if alertDefinition.Id == id {
			return &alertDefinition
		}
	}
	return nil
}

func (a *AlertManager) RunAlertScheduler() error {
	a.mu.RLock()
	loadedAlertDefinitions := a.allDefinitions()
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
				a.logger.Error().Err(err).Str("alertId", alertDefinition.Id.String()).Msg("startup evaluation failed, will retry on next schedule")
			} else {
				err = a.alertResultStore.PersistResultAndNotifyIfChanged(alertDefinition.Id, alertResult, func() error {
					return a.notifyAlertChange(alertDefinition, alertResult)
				})
				if err != nil {
					a.logger.Error().Err(err).Str("alertId", alertDefinition.Id.String()).Msg("persisting startup alert result failed, will retry on next schedule")
				}
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

	// the cronjob to test alerts is running
	if a.config.Alerting.AlertCronMonitorSchedule != "" && a.config.Alerting.AlertCronMonitorUrl != "" {
		a.logger.Debug().
			Str("schedule", a.config.Alerting.AlertCronMonitorSchedule).
			Msg("alerting cron monitor is defined, scheduling '%w'")
		taskr.Task(a.config.Alerting.AlertCronMonitorSchedule, func(ctx context.Context) (int, error) {
			err := a.sendCronHeartBeat(a.config.Alerting.AlertCronMonitorUrl)
			a.logger.Info().Msg("notified cron monitor")
			return 0, err
		})
	} else {
		a.logger.Info().Msg("no alerting cron monitor defined!")
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

func (a *AlertManager) sendCronHeartBeat(cronMonitorUrl string) error {
	resp, err := http.Get(cronMonitorUrl)
	defer func(Body io.ReadCloser) {
		_ = Body.Close()
	}(resp.Body)
	if err != nil {
		return fmt.Errorf("failed to sent cron heartbeat: %w", err)
	}

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
