package alerting

import (
	"fmt"
	"os"
	"testing"

	"github.com/rs/zerolog"
	"github.com/sandstorm/dashica/server/clickhouse"
	"github.com/sandstorm/dashica/server/core"
	testServer "github.com/sandstorm/dashica/server/test-utils/test-server"
	"github.com/stretchr/testify/require"
)

// TestAlertResultStore tests with a real ClickHouse database
func TestAlertResultStore(t *testing.T) {
	logger := zerolog.New(zerolog.ConsoleWriter{Out: os.Stderr})
	config, _ := testServer.LoadTestingConfig(t)
	clickhouseManager := clickhouse.NewManager(config, logger)
	clickhouseClient, err := clickhouseManager.GetClient("alert_storage")
	require.NoError(t, err)
	currentTime := core.NewVirtualTimeProvider()
	alertResultStore := NewAlertResultStore(logger, clickhouseClient)

	t.Run("PersistResultAndNotifyIfChanged - updates in-memory state and database", func(t *testing.T) {
		require.NoError(t, currentTime.SetTime("2025-04-04 10:00:01"))
		require.NoError(t, alertResultStore.ClearAll())
		require.NoError(t, alertResultStore.LoadAlertStatusIntoMemory())
		require.Empty(t, alertResultStore.currentAlertStatus)

		// Initial Alert - WARNING
		alertId := AlertId{Group: "g1", Key: "k1"}
		require.NoError(t, alertResultStore.PersistResultAndNotifyIfChanged(alertId, &AlertResult{
			State:     AlertStateWarn,
			Message:   "Warning 1",
			Timestamp: currentTime.Now(),
		}, noNotification))

		require.Equal(t, &currentAlertStatus{
			AlertIdGroup:    "g1",
			AlertIdKey:      "k1",
			LatestStatus:    "warn",
			LatestMessage:   "Warning 1",
			LatestTimestamp: currentTime.Now(),
		}, alertResultStore.currentAlertStatus[alertId])

		// NEXT ALERT - WARNING again (must be discarded)
		currentTime.IncreaseByOneMinute()
		require.NoError(t, alertResultStore.PersistResultAndNotifyIfChanged(alertId, &AlertResult{
			State:     AlertStateWarn,
			Message:   "Warning 2", // to discard
			Timestamp: currentTime.Now(),
		}, noNotification))
		// we need to subtract the minute we just added, because we fully discard
		// the element.
		currentTime.DecreaseByOneMinute()
		require.Equal(t, &currentAlertStatus{
			AlertIdGroup:    "g1",
			AlertIdKey:      "k1",
			LatestStatus:    "warn",
			LatestMessage:   "Warning 1",
			LatestTimestamp: currentTime.Now(),
		}, alertResultStore.currentAlertStatus[alertId])

		// NEXT ALERT for same alert ID
		currentTime.IncreaseByOneMinute()
		require.NoError(t, alertResultStore.PersistResultAndNotifyIfChanged(alertId, &AlertResult{
			State:     AlertStateOk,
			Message:   "",
			Timestamp: currentTime.Now(),
		}, noNotification))

		require.Equal(t, &currentAlertStatus{
			AlertIdGroup:    "g1",
			AlertIdKey:      "k1",
			LatestStatus:    "OK",
			LatestMessage:   "",
			LatestTimestamp: currentTime.Now(),
		}, alertResultStore.currentAlertStatus[alertId])

		// now, flush in-memory store and see if it loads correctly
		secondAlertResultStore := NewAlertResultStore(logger, clickhouseClient)
		require.NoError(t, secondAlertResultStore.LoadAlertStatusIntoMemory())
		require.Equal(t, &currentAlertStatus{
			AlertIdGroup:    "g1",
			AlertIdKey:      "k1",
			LatestStatus:    "OK",
			LatestTimestamp: currentTime.Now(),
		}, secondAlertResultStore.currentAlertStatus[alertId])
	})

	t.Run("PersistResultAndNotifyIfChanged - persists error if notification failed", func(t *testing.T) {
		require.NoError(t, currentTime.SetTime("2025-04-04 10:00:01"))
		require.NoError(t, alertResultStore.ClearAll())
		require.NoError(t, alertResultStore.LoadAlertStatusIntoMemory())
		require.Empty(t, alertResultStore.currentAlertStatus)

		// Initial Alert - NORMAL - but with failed notifier
		alertId := AlertId{Group: "g1", Key: "k1"}
		require.NoError(t, alertResultStore.PersistResultAndNotifyIfChanged(alertId, &AlertResult{
			State:     AlertStateOk,
			Message:   "All OK - should be overridden on notification error",
			Timestamp: currentTime.Now(),
		}, func() error {
			return fmt.Errorf("notification failed with some error")
		}))

		require.Equal(t, &currentAlertStatus{
			AlertIdGroup:    "g1",
			AlertIdKey:      "k1",
			LatestStatus:    "error",
			LatestMessage:   "Error triggering notifier: notification failed with some error",
			LatestTimestamp: currentTime.Now(),
		}, alertResultStore.currentAlertStatus[alertId])
	})

	t.Run("PersistResultAndNotifyIfChanged - force inserts new result every day directly after midnight", func(t *testing.T) {
		require.NoError(t, currentTime.SetTime("2025-04-04 15:00:01"))
		require.NoError(t, alertResultStore.ClearAll())
		require.NoError(t, alertResultStore.LoadAlertStatusIntoMemory())
		require.Empty(t, alertResultStore.currentAlertStatus)

		// Initial Alert - WARNING
		alertId := AlertId{Group: "g1", Key: "k1"}
		require.NoError(t, alertResultStore.PersistResultAndNotifyIfChanged(alertId, &AlertResult{
			State:     AlertStateWarn,
			Message:   "Warning 1",
			Timestamp: currentTime.Now(),
		}, noNotification))

		require.NoError(t, currentTime.SetTime("2025-04-05 00:05:01")) // next day
		require.NoError(t, alertResultStore.PersistResultAndNotifyIfChanged(alertId, &AlertResult{
			State:     AlertStateWarn,
			Message:   "Warning 2 - PERSISTED",
			Timestamp: currentTime.Now(),
		}, noNotification))

		require.Equal(t, &currentAlertStatus{
			AlertIdGroup:    "g1",
			AlertIdKey:      "k1",
			LatestStatus:    "warn",
			LatestMessage:   "Warning 2 - PERSISTED",
			LatestTimestamp: currentTime.Now(),
		}, alertResultStore.currentAlertStatus[alertId])

		// NEXT ALERT - WARNING again (must be discarded)
		currentTime.IncreaseByOneMinute()
		require.NoError(t, alertResultStore.PersistResultAndNotifyIfChanged(alertId, &AlertResult{
			State:     AlertStateWarn,
			Message:   "Warning 2", // to discard
			Timestamp: currentTime.Now(),
		}, noNotification))
		// we need to subtract the minute we just added, because we fully discard
		// the element.
		currentTime.DecreaseByOneMinute()
		require.Equal(t, &currentAlertStatus{
			AlertIdGroup:    "g1",
			AlertIdKey:      "k1",
			LatestStatus:    "warn",
			LatestMessage:   "Warning 2 - PERSISTED",
			LatestTimestamp: currentTime.Now(),
		}, alertResultStore.currentAlertStatus[alertId])

		// now, flush in-memory store and see if it loads correctly
		secondAlertResultStore := NewAlertResultStore(logger, clickhouseClient)
		require.NoError(t, secondAlertResultStore.LoadAlertStatusIntoMemory())
		require.Equal(t, &currentAlertStatus{
			AlertIdGroup:    "g1",
			AlertIdKey:      "k1",
			LatestStatus:    "warn",
			LatestMessage:   "Warning 2 - PERSISTED",
			LatestTimestamp: currentTime.Now(),
		}, secondAlertResultStore.currentAlertStatus[alertId])
	})
}
