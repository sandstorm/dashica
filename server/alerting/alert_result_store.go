package alerting

import (
	"context"
	"fmt"
	"github.com/rs/zerolog"
	"github.com/sandstorm/dashica/server/clickhouse"
	"github.com/sandstorm/dashica/server/core"
	"sync"
)

// NewAlertResultStore creates the persistence adapter for storing alert results (i.e. "X is red now, Y is OK again")
// in ClickHouse.
// the passed clickhouseClient is the correct connection where alerts should be stored in.
//
// only persists alerts if there status changes (e.g. from "OK" to "error", or from "error" to "warn").
func NewAlertResultStore(logger zerolog.Logger, clickhouseClient *clickhouse.Client) *AlertResultStore {
	return &AlertResultStore{
		logger:           logger,
		clickhouseClient: clickhouseClient,
	}
}

type AlertResultStore struct {
	logger           zerolog.Logger
	clickhouseClient *clickhouse.Client

	// mutex protecting currentAlertStatus
	mu                 sync.RWMutex
	currentAlertStatus map[AlertId]*currentAlertStatus
}

func (s *AlertResultStore) ClickhouseClient() *clickhouse.Client {
	return s.clickhouseClient
}

const LOAD_QUERY = `
SELECT
    alert_id_group,
    alert_id_key,
    max(timestamp) AS latest_timestamp,

    -- select last status,message of timestamp
    argMax(status, timestamp) AS latest_status,
    argMax(message, timestamp) AS latest_message
FROM dashica_alert_events
GROUP BY alert_id_group, alert_id_key
ORDER BY alert_id_group, alert_id_key
`

type currentAlertStatus struct {
	AlertIdGroup    string    `json:"alert_id_group"`
	AlertIdKey      string    `json:"alert_id_key"`
	LatestTimestamp core.Time `json:"latest_timestamp"`
	LatestStatus    string    `json:"latest_status"`
	LatestMessage   string    `json:"latest_message"`
}

func (s currentAlertStatus) AlertId() AlertId {
	return AlertId{
		Group: s.AlertIdGroup,
		Key:   s.AlertIdKey,
	}
}

func (s *AlertResultStore) LoadAlertStatusIntoMemory() error {
	queryOpts := clickhouse.DefaultQueryOptions()
	resultset, err := clickhouse.QueryJSON[currentAlertStatus](context.Background(), s.clickhouseClient, LOAD_QUERY, queryOpts)
	if err != nil {
		return fmt.Errorf("loading alert events into memory: %w", err)
	}

	statusIndexedById := make(map[AlertId]*currentAlertStatus)
	for _, row := range resultset.Data {
		statusIndexedById[row.AlertId()] = &row
	}
	s.mu.Lock()
	s.currentAlertStatus = statusIndexedById
	s.mu.Unlock()

	return nil
}

const PERSIST_RESULT_QUERY = `
INSERT INTO dashica_alert_events(alert_id_group, alert_id_key, timestamp, status, message)
VALUES({alert_id_group:String}, {alert_id_key:String}, {timestamp:DateTime}, {status:String}, {message:String})
`

// TODO: maybe implement me: if({alert_result_timestamp:String} != '', toDateTime( {alert_result_timestamp:String}), NULL)

// PersistResultAndNotifyIfChanged stores alertResults in the database in case of status changes; and triggers a notification callback in this case
func (s *AlertResultStore) PersistResultAndNotifyIfChanged(id AlertId, result *AlertResult, notifier func() error) error {
	s.mu.RLock()

	// This condition needs explaining:
	// 1) we want to ONLY insert rows into dashica_alert_events if it's a status change.
	//    (OK -> err, err -> warn, ...)
	//
	// 2) HOWEVER, we want to ensure that at least once a day, an entry is written to dashica_alert_events
	//    (even if it has the same value as before).
	//
	//    This is to allow visualizing the alert history properly. Otherwise, the following could happen
	//    for alerts which NEVER toggle during the retention time:
	//      --OK-------------------------------> time
	//           |--- alert retention time -----
	//                                     ^^^^^ time window to display alert history
	//        ^^ we drop this "OK" -> thus we would lose status information for the displayed
	//                                alert history.
	//
	//     To remedy this, we add the status at least once a day, leading to the
	//     following image:
	//      --OK-----OK-----OK------OK-----OK--> time
	//           |--- alert retention time -----
	//                                     ^^^^^ time window to display alert history
	//
	//      => this is done by the el.LatestTimestamp.SameDayAs(result.Timestamp) part.
	if el := s.currentAlertStatus[id]; el != nil && el.LatestStatus == result.State && el.LatestTimestamp.SameDayAs(result.Timestamp) {
		s.mu.RUnlock()
		return nil
	} else {
		s.mu.RUnlock()
	}

	// trigger alert notifier
	err := notifier()
	if err != nil {
		// if there was an error triggering the notifier, we persist this as errored AlertResult; to ensure
		// we can see this in the Dashica UI.
		result = &AlertResult{
			State:     AlertStateError,
			Message:   "Error triggering notifier: " + err.Error(),
			Timestamp: result.Timestamp,
		}
	}

	queryOpts := clickhouse.DefaultQueryOptions()
	queryOpts.Parameters["alert_id_group"] = id.Group
	queryOpts.Parameters["alert_id_key"] = id.Key
	queryOpts.Parameters["timestamp"] = result.Timestamp.ToDbStr()
	queryOpts.Parameters["status"] = result.State // TODO: state vs status
	// queryOpts.Parameters["alert_result_timestamp"] = "" // TODO IMPLEMENT ME??
	queryOpts.Parameters["message"] = result.Message

	_, err = s.clickhouseClient.Execute(context.Background(), PERSIST_RESULT_QUERY, queryOpts)

	if err != nil {
		return fmt.Errorf("persisting %s: %w", id.String(), err)
	}

	// persist succeeded, we need to update our in-memory map
	s.mu.Lock()
	if _, exists := s.currentAlertStatus[id]; !exists {
		s.currentAlertStatus[id] = &currentAlertStatus{
			AlertIdGroup:    id.Group,
			AlertIdKey:      id.Key,
			LatestTimestamp: result.Timestamp,
			LatestStatus:    result.State,
			LatestMessage:   result.Message,
		}
	} else {
		// Update existing entry
		s.currentAlertStatus[id].LatestTimestamp = result.Timestamp
		s.currentAlertStatus[id].LatestStatus = result.State
		s.currentAlertStatus[id].LatestMessage = result.Message
	}
	s.mu.Unlock()

	return nil
}

const TRUNCATE_TABLE_QUERY = `
TRUNCATE dashica_alert_events
`

func (s *AlertResultStore) ClearAll() error {
	_, err := s.clickhouseClient.Execute(context.Background(), TRUNCATE_TABLE_QUERY, clickhouse.DefaultQueryOptions())
	if err != nil {
		return fmt.Errorf("truncating dashica_alert_events: %w", err)
	}

	s.mu.Lock()
	s.currentAlertStatus = make(map[AlertId]*currentAlertStatus)
	s.mu.Unlock()
	return nil
}
