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
	// YAML-based path: non-zero alertId, query/alertIf are zero
	alertId alerting.AlertId
	// Go-based path: query and alertIf set directly, alertId is zero
	query   sql.SqlQueryable
	alertIf alerting.AlertCondition

	title string
	id    string
}

// NewAlertDetail creates an AlertDetail backed by a YAML-configured alert.
// The alert definition is looked up from the AlertManager at query time.
func NewAlertDetail(alertGroup, alertKey string) *AlertDetail {
	return &AlertDetail{
		alertId: alerting.AlertId{Group: alertGroup, Key: alertKey},
		title:   alertGroup + "#" + alertKey,
	}
}

// NewAlertDetailFromAlert creates an AlertDetail from a Go-configured Alert.
// The query and threshold are embedded directly — no AlertManager lookup needed.
func NewAlertDetailFromAlert(alert *alerting.Alert) *AlertDetail {
	return &AlertDetail{
		query:   alert.GetQuery(),
		alertIf: alert.GetAlertIf(),
		title:   alert.Key(),
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

	if a.query != nil {
		return a.collectHandlersGoAlert(ctx, registerHandler)
	}
	return a.collectHandlersYamlAlert(ctx, registerHandler)
}

func (a *AlertDetail) collectHandlersGoAlert(ctx *rendering.DashboardContext, registerHandler handler_collector.HandlerCollector) error {
	query := a.query
	alertIf := a.alertIf

	err := registerHandler.Handle(a.id+"/query", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		client, err := ctx.Deps.ClickhouseClientManager.GetClient("default")
		if err != nil {
			http.Error(w, "get clickhouse client: "+err.Error(), http.StatusInternalServerError)
			return
		}

		opts := clickhouse.DefaultQueryOptions()
		opts.Settings["output_format_arrow_compression_method"] = "none"
		opts.Settings["date_time_input_format"] = "best_effort"

		resolvedQuery := query
		rawFilters := r.URL.Query().Get("filters")
		if rawFilters != "" {
			var filters httpserver.DashboardFilters
			if err = json.Unmarshal([]byte(rawFilters), &filters); err != nil {
				http.Error(w, "unmarshalling filters: "+err.Error(), http.StatusInternalServerError)
				return
			}
			if c := filters.SqlClause(); c != "" {
				resolvedQuery = resolvedQuery.With(sql.Where(c))
			}
			resolvedTimeRange, err := filters.ResolveTimeRangeFromDb(r.Context(), client)
			if err != nil {
				http.Error(w, "resolving time range: "+err.Error(), http.StatusInternalServerError)
				return
			}
			w.Header().Add("X-Dashica-Resolved-Time-Range", resolvedTimeRange)
		}

		resolvedAlertIf, err := json.Marshal(alertIf)
		if err != nil {
			http.Error(w, "json marshal alert_if: "+err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Add("X-Dashica-Alert-If", string(resolvedAlertIf))

		if err = client.QueryToHandler(r.Context(), resolvedQuery.Build(), opts, w); err != nil {
			http.Error(w, "clickhouse query: "+err.Error(), http.StatusInternalServerError)
		}
	}))
	if err != nil {
		return fmt.Errorf("alertDetail: %w", err)
	}

	err = registerHandler.Handle(a.id+"/debug", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"query": query.Build()})
	}))
	if err != nil {
		return fmt.Errorf("alertDetail debug: %w", err)
	}

	return nil
}

func (a *AlertDetail) collectHandlersYamlAlert(ctx *rendering.DashboardContext, registerHandler handler_collector.HandlerCollector) error {
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
