package httpserver

import (
	"encoding/json"
	"fmt"
	"github.com/rs/zerolog"
	"github.com/sandstorm/dashica/server/alerting"
	"github.com/sandstorm/dashica/server/clickhouse"
	"net/http"
)

type queryAlertsHandler struct {
	clickhouseClientManager *clickhouse.Manager
	logger                  zerolog.Logger
	alertManager            *alerting.AlertManager
	alertResultStore        *alerting.AlertResultStore
	devMode                 bool
}

const QUERY_ALERTS_QUERY = `
WITH
    (leadInFrame(timestamp) OVER (
        PARTITION BY alert_id_group, alert_id_key
        ORDER BY timestamp
        ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
        )) as end_ts_expr
SELECT
    concat(alert_id_group, '#', alert_id_key) as alert_id,
    alert_id_group,
    alert_id_key,
    timestamp::DateTime64 as start,
    status::String as status,
    message,
    -- for last value, fill with now() -- alert state stays active until now.
    if(end_ts_expr = 0, now()::DateTime64, end_ts_expr::DateTime64) as end
FROM
    dashica_alert_events
ORDER BY
    alert_id_group, alert_id_key, timestamp
`

func (qa queryAlertsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) error {
	if qa.devMode {
		// rescan on every alert
		err := qa.alertManager.DiscoverAlertDefinitions()
		if err != nil {
			return err
		}
	}

	client, err := qa.clickhouseClientManager.GetClient("alert_storage")
	if err != nil {
		return fmt.Errorf("get clickhouse client for alert_storage: %w", err)
	}

	opts := clickhouse.DefaultQueryOptions()
	opts.Settings["output_format_arrow_compression_method"] = "none" // compression not supported by arrow JS
	opts.Settings["date_time_input_format"] = "best_effort"          // support ISO 8601 dates (which is used in date picker by browser)

	rawFilters := r.URL.Query().Get("filters")
	if rawFilters != "" {
		var filters DashboardFilters
		err = json.Unmarshal([]byte(rawFilters), &filters)
		if err != nil {
			return fmt.Errorf("unmarshalling filters: %w", err)
		}

		// add resolved time range to response, so that charts also show the full range if they have no data at beginning or end
		resolvedTimeRange, err := filters.ResolveTimeRangeFromDb(r.Context(), client)
		if err != nil {
			return fmt.Errorf("resolving time range: %w", err)
		}
		w.Header().Add("X-Dashica-Resolved-Time-Range", resolvedTimeRange)
	}
	if qa.devMode {
		w.Header().Add("X-Dashica-DevMode", "1")
	}

	err = client.QueryToHandler(r.Context(), QUERY_ALERTS_QUERY, opts, w)
	if err != nil {
		return fmt.Errorf("clickhouse query: %w", err)
	}
	return nil
}
