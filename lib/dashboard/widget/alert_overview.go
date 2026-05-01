package widget

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/a-h/templ"
	"github.com/sandstorm/dashica/lib/clickhouse"
	"github.com/sandstorm/dashica/lib/components/widget_component"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/httpserver"
	"github.com/sandstorm/dashica/lib/util/handler_collector"
)

type AlertOverview struct {
	alertGroupPattern string
	id                string
}

func NewAlertOverview(alertGroupPattern string) *AlertOverview {
	return &AlertOverview{
		alertGroupPattern: alertGroupPattern,
	}
}

func (a *AlertOverview) BuildComponents(ctx *rendering.DashboardContext) (templ.Component, error) {
	if len(a.id) == 0 {
		a.id = ctx.NextWidgetId()
	}

	chartPropsJSON, err := json.Marshal(map[string]interface{}{})
	if err != nil {
		return nil, fmt.Errorf("alertOverview: failed to marshal chart props: %w", err)
	}

	return widget_component.Chart(ctx.CurrentHandlerUrl+"/api/"+a.id, "alertOverview", string(chartPropsJSON)), nil
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

func (a *AlertOverview) CollectHandlers(ctx *rendering.DashboardContext, registerHandler handler_collector.HandlerCollector) error {
	if len(a.id) == 0 {
		a.id = ctx.NextWidgetId()
	}

	pattern := a.alertGroupPattern

	err := registerHandler.Handle(a.id+"/query", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		client, err := ctx.Deps.ClickhouseClientManager.GetClient("alert_storage")
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
	}))
	if err != nil {
		return fmt.Errorf("alertOverview: %w", err)
	}

	// Debug endpoint (minimal)
	err = registerHandler.Handle(a.id+"/debug", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"query": alertOverviewQuery, "pattern": pattern})
	}))
	if err != nil {
		return fmt.Errorf("alertOverview debug: %w", err)
	}

	return nil
}

var _ InteractiveWidget = (*AlertOverview)(nil)
