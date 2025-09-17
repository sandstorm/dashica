package httpserver

import (
	"encoding/json"
	"fmt"
	"github.com/rs/zerolog"
	"github.com/sandstorm/dashica/server/clickhouse"
	"io/fs"
	"net/http"
)

type speedscopeQueryHandler struct {
	clickhouseClientManager *clickhouse.Manager
	logger                  zerolog.Logger
	fileSystem              fs.ReadFileFS
}

func (qh speedscopeQueryHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) error {
	fileName := r.URL.Query().Get("fileName")
	if fileName == "" {
		return fmt.Errorf("missing required 'fileName' parameter")
	}

	// TODO: SANITIZE FILE STRING -> SECURITY!!! -> NO PARENT PATH TRAVERSAL ETC.
	fileContent, err := qh.fileSystem.ReadFile("client" + fileName)
	if err != nil {
		return fmt.Errorf("reading file %s: %w", fileName, err)
	}

	client, err := qh.clickhouseClientManager.GetClientForSqlFile(fileName)
	if err != nil {
		return fmt.Errorf("get clickhouse client for %s: %w", fileName, err)
	}

	opts := clickhouse.DefaultQueryOptions()
	opts.Format = "CSV"
	opts.Settings["format_custom_field_delimiter"] = " "
	opts.Settings["date_time_input_format"] = "best_effort" // support ISO 8601 dates (which is used in date picker by browser)

	paramsStr := r.URL.Query().Get("params")
	if paramsStr != "" {
		var params map[string]string
		err = json.Unmarshal([]byte(paramsStr), &params)
		if err != nil {
			return fmt.Errorf("unmarshalling params: %w", err)
		}
		opts.Parameters = params
	}

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
		resolvedTimeRange, err := filters.ResolveTimeRangeFromDbAsTime(r.Context(), client)
		if err != nil {
			return fmt.Errorf("resolving time range: %w", err)
		}
		opts.Parameters["__from"] = fmt.Sprintf("%d", *resolvedTimeRange.From/1000)
		opts.Parameters["__to"] = fmt.Sprintf("%d", *resolvedTimeRange.To/1000)

		resolvedTimeRangeJson, err := json.Marshal(resolvedTimeRange)
		if err != nil {
			return fmt.Errorf("JSON marshalling: %w", err)
		}
		w.Header().Add("X-Dashica-Resolved-Time-Range", string(resolvedTimeRangeJson))

	}

	err = client.QueryToHandler(r.Context(), string(fileContent), opts, w)
	if err != nil {
		return fmt.Errorf("clickhouse query: %w", err)
	}

	return nil
}
