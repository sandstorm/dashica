package widget

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/sandstorm/dashica/lib/alerting"
	"github.com/sandstorm/dashica/lib/clickhouse"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
	"github.com/sandstorm/dashica/lib/httpserver"
)

type AlertDetail struct {
	// alertGroup and alertKey identify the alert whose history this widget renders.
	alertGroup string `dashica-gen:"client"`
	alertKey   string `dashica-gen:"client"`
	// title is the chart title shown above the plot. Defaults to "group#key".
	title string `dashica-gen:"client"`
}

func NewAlertDetail(alertGroup, alertKey string) *AlertDetail {
	return &AlertDetail{
		alertGroup: alertGroup,
		alertKey:   alertKey,
		title:      alertGroup + "#" + alertKey,
	}
}

func (a *AlertDetail) Title(title string) *AlertDetail {
	cloned := *a
	cloned.title = title
	return &cloned
}

func (a *AlertDetail) Handler(deps rendering.Dependencies) http.Handler {
	alertId := alerting.AlertId{Group: a.alertGroup, Key: a.alertKey}
	mux := http.NewServeMux()

	mux.HandleFunc("/query", func(w http.ResponseWriter, r *http.Request) {
		alertDef := deps.AlertManager.GetAlertDefinition(alertId)
		if alertDef == nil {
			http.Error(w, fmt.Sprintf("alert definition %s#%s not found", alertId.Group, alertId.Key), http.StatusNotFound)
			return
		}

		client, err := deps.ClickhouseClientManager.GetClient("default")
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
	})

	mux.HandleFunc("/debug", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"alertId": alertId.Group + "#" + alertId.Key})
	})
	return mux
}
