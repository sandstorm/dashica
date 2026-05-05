package widget

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/a-h/templ"
	"github.com/sandstorm/dashica/lib/alerting"
	"github.com/sandstorm/dashica/lib/clickhouse"
	"github.com/sandstorm/dashica/lib/components/widget_component"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
	"github.com/sandstorm/dashica/lib/httpserver"
	"github.com/sandstorm/dashica/lib/util/handler_collector"
)

type AlertDetail struct {
	alertId alerting.AlertId
	title   string
	id      string
}

func NewAlertDetail(alertGroup, alertKey string) *AlertDetail {
	return &AlertDetail{
		alertId: alerting.AlertId{Group: alertGroup, Key: alertKey},
		title:   alertGroup + "#" + alertKey,
	}
}

func (a *AlertDetail) Title(title string) *AlertDetail {
	cloned := *a
	cloned.title = title
	return &cloned
}

func (a *AlertDetail) BuildComponents(ctx *rendering.DashboardContext) (templ.Component, error) {
	if len(a.id) == 0 {
		a.id = ctx.NextWidgetId()
	}

	props := map[string]interface{}{
		"title":       a.title,
		"height":      200,
		"x":           "time",
		"xBucketSize": 15 * 60 * 1000,
		"y":           "value",
	}
	chartPropsJSON, err := json.Marshal(props)
	if err != nil {
		return nil, fmt.Errorf("alertDetail: failed to marshal chart props: %w", err)
	}

	return widget_component.Chart(ctx.CurrentHandlerUrl+"/api/"+a.id, "timeBar", string(chartPropsJSON), 200), nil
}

func (a *AlertDetail) CollectHandlers(ctx *rendering.DashboardContext, registerHandler handler_collector.HandlerCollector) error {
	if len(a.id) == 0 {
		a.id = ctx.NextWidgetId()
	}

	alertId := a.alertId

	err := registerHandler.Handle(a.id+"/query", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		alertDef := ctx.Deps.AlertManager.GetAlertDefinition(alertId)
		if alertDef == nil {
			http.Error(w, fmt.Sprintf("alert definition %s#%s not found", alertId.Group, alertId.Key), http.StatusNotFound)
			return
		}

		client, err := ctx.Deps.ClickhouseClientManager.GetClient("default")
		if err != nil {
			http.Error(w, "get clickhouse client: "+err.Error(), http.StatusInternalServerError)
			return
		}

		opts := clickhouse.DefaultQueryOptions()
		opts.Settings["output_format_arrow_compression_method"] = "none"
		opts.Settings["date_time_input_format"] = "best_effort"
		opts.Parameters = alertDef.Params

		query := alertDef.Query
		filterClause := "1=1"
		rawFilters := r.URL.Query().Get("filters")
		if rawFilters != "" {
			var filters httpserver.DashboardFilters
			err = json.Unmarshal([]byte(rawFilters), &filters)
			if err != nil {
				http.Error(w, "unmarshalling filters: "+err.Error(), http.StatusInternalServerError)
				return
			}
			if c := filters.SqlClause(); c != "" {
				filterClause = "(" + c + ")"
			}

			resolvedTimeRange, err := filters.ResolveTimeRangeFromDb(r.Context(), client)
			if err != nil {
				http.Error(w, "resolving time range: "+err.Error(), http.StatusInternalServerError)
				return
			}
			w.Header().Add("X-Dashica-Resolved-Time-Range", resolvedTimeRange)
		}
		query = strings.ReplaceAll(query, sql.DashicaFiltersPlaceholder, filterClause)

		// Add threshold info so frontend can draw threshold lines
		resolvedAlertIf, err := json.Marshal(alertDef.AlertIf)
		if err != nil {
			http.Error(w, "json marshal alert_if: "+err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Add("X-Dashica-Alert-If", string(resolvedAlertIf))

		err = client.QueryToHandler(r.Context(), query, opts, w)
		if err != nil {
			http.Error(w, "clickhouse query: "+err.Error(), http.StatusInternalServerError)
			return
		}
	}))
	if err != nil {
		return fmt.Errorf("alertDetail: %w", err)
	}

	err = registerHandler.Handle(a.id+"/debug", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"alertId": alertId.Group + "#" + alertId.Key})
	}))
	if err != nil {
		return fmt.Errorf("alertDetail debug: %w", err)
	}

	return nil
}

var _ InteractiveWidget = (*AlertDetail)(nil)
