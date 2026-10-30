package widget

import (
	"encoding/json"
	"net/http"

	"github.com/sandstorm/dashica/lib/clickhouse"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/httpserver"
)

type AlertOverview struct {
	// alertGroupPattern is an ILIKE pattern (e.g. "prod-%") selecting which
	// alert groups' history rows are shown.
	alertGroupPattern string `dashica-gen:"client"`
}

func NewAlertOverview(alertGroupPattern string) *AlertOverview {
	return &AlertOverview{
		alertGroupPattern: alertGroupPattern,
	}
}

const alertOverviewQuery = `
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
    if(end_ts_expr = 0, now()::DateTime64, end_ts_expr::DateTime64) as end
FROM
    dashica_alert_events
WHERE
    alert_id_group ILIKE {alert_group_pattern:String}
ORDER BY
    alert_id_group, alert_id_key, timestamp
`

func (a *AlertOverview) Handler(deps rendering.Dependencies) http.Handler {
	pattern := a.alertGroupPattern
	mux := http.NewServeMux()

	mux.HandleFunc("/query", func(w http.ResponseWriter, r *http.Request) {
		client, err := deps.ClickhouseClientManager.GetClient("alert_storage")
		if err != nil {
			http.Error(w, "get clickhouse client for alert_storage: "+err.Error(), http.StatusInternalServerError)
			return
		}

		opts := clickhouse.DefaultQueryOptions()
		opts.Settings["output_format_arrow_compression_method"] = "none"
		opts.Settings["date_time_input_format"] = "best_effort"
		opts.Parameters = map[string]string{
			"alert_group_pattern": pattern,
		}

		rawFilters := r.URL.Query().Get("filters")
		if rawFilters != "" {
			var filters httpserver.DashboardFilters
			err = json.Unmarshal([]byte(rawFilters), &filters)
			if err != nil {
				http.Error(w, "unmarshalling filters: "+err.Error(), http.StatusInternalServerError)
				return
			}
			resolvedTimeRange, err := filters.ResolveTimeRangeFromDb(r.Context(), client)
			if err != nil {
				http.Error(w, "resolving time range: "+err.Error(), http.StatusInternalServerError)
				return
			}
			w.Header().Add("X-Dashica-Resolved-Time-Range", resolvedTimeRange)
		}

		err = client.QueryToHandler(r.Context(), alertOverviewQuery, opts, w)
		if err != nil {
			http.Error(w, "clickhouse query: "+err.Error(), http.StatusInternalServerError)
			return
		}
	})

	// Debug endpoint (minimal)
	mux.HandleFunc("/debug", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"query": alertOverviewQuery, "pattern": pattern})
	})
	return mux
}
