package httpserver

import (
	"encoding/json"
	"fmt"
	"github.com/rs/zerolog"
	"github.com/sandstorm/dashica/server/alerting"
	"github.com/sandstorm/dashica/server/clickhouse"
	"net/http"
)

type queryAlertChartHandler struct {
	clickhouseClientManager *clickhouse.Manager
	logger                  zerolog.Logger
	alertManager            *alerting.AlertManager
}

func (qh queryAlertChartHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) error {
	alertId := r.URL.Query().Get("alertId")
	if alertId == "" {
		return fmt.Errorf("missing required 'alertId' parameter")
	}

	alertDefinition := qh.alertManager.GetAlertDefinition(alerting.AlertIdFromString(alertId))
	if alertDefinition == nil {
		return fmt.Errorf("alert definition %s not found", alertId)
	}

	client, err := qh.clickhouseClientManager.GetClientForSqlFile(alertDefinition.QueryPath)
	if err != nil {
		return fmt.Errorf("get clickhouse client for %s: %w", alertDefinition.QueryPath, err)
	}

	opts := clickhouse.DefaultQueryOptions()
	opts.Settings["output_format_arrow_compression_method"] = "none" // compression not supported by arrow JS
	opts.Settings["date_time_input_format"] = "best_effort"          // support ISO 8601 dates (which is used in date picker by browser)

	opts.Parameters = alertDefinition.Params

	rawFilters := r.URL.Query().Get("filters")
	if rawFilters != "" {
		var filters DashboardFilters
		err = json.Unmarshal([]byte(rawFilters), &filters)
		if err != nil {
			return fmt.Errorf("unmarshalling filters: %w", err)
		}
		schema, err := client.IntrospectSchema(r.Context())
		if err != nil {
			return fmt.Errorf("introspecting schema: %w", err)
		}
		opts.Settings["additional_table_filters"] = formatClickhouseMap(filters.SqlStringForAllTables(schema.Tables))

		// add resolved time range to response, so that charts also show the full range if they have no data at beginning or end
		resolvedTimeRange, err := filters.ResolveTimeRangeFromDb(r.Context(), client)
		if err != nil {
			return fmt.Errorf("resolving time range: %w", err)
		}
		w.Header().Add("X-Dashica-Resolved-Time-Range", resolvedTimeRange)
	}

	resolvedAlertIf, err := json.Marshal(alertDefinition.AlertIf)
	if err != nil {
		return fmt.Errorf("json marshal: %w", err)
	}
	w.Header().Add("X-Dashica-Alert-If", string(resolvedAlertIf))

	err = client.QueryToHandler(r.Context(), alertDefinition.Query, opts, w)
	if err != nil {
		return fmt.Errorf("clickhouse query: %w", err)
	}

	return nil
}
