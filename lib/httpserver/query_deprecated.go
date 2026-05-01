package httpserver

import (
	"encoding/json"
	"fmt"
	"net/http"
	"path"
	"strings"

	"github.com/sandstorm/dashica/lib/clickhouse"
	querying2 "github.com/sandstorm/dashica/lib/httpserver/querying"
)

func (qh QueryHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) error {
	fileName := r.URL.Query().Get("fileName")
	if fileName == "" {
		return fmt.Errorf("missing required 'fileName' parameter")
	}

	filePath := path.Clean(strings.TrimLeft(fileName, "./"))
	fileContent, err := qh.FileSystem.ReadFile(filePath)
	if err != nil {
		return fmt.Errorf("reading file %s: %w", fileName, err)
	}

	client, err := qh.ClickhouseClientManager.GetClientForSqlFile(fileName)
	if err != nil {
		return fmt.Errorf("get clickhouse client for %s: %w", fileName, err)
	}

	opts := clickhouse.DefaultQueryOptions()
	opts.Settings["output_format_arrow_compression_method"] = "none" // compression not supported by arrow JS
	opts.Settings["date_time_input_format"] = "best_effort"          // support ISO 8601 dates (which is used in date picker by browser)

	paramsStr := r.URL.Query().Get("params")
	if paramsStr != "" {
		var params map[string]string
		err = json.Unmarshal([]byte(paramsStr), &params)
		if err != nil {
			return fmt.Errorf("unmarshalling params: %w", err)
		}
		opts.Parameters = params
	}

	query := string(fileContent)
	rawFilters := r.URL.Query().Get("filters")
	if rawFilters != "" {
		var filters DashboardFilters
		err = json.Unmarshal([]byte(rawFilters), &filters)
		if err != nil {
			return fmt.Errorf("unmarshalling filters: %w", err)
		}
		filters.calculateLegacyFilters()
		schema, err := client.IntrospectSchema(r.Context())
		if err != nil {
			return fmt.Errorf("introspecting schema: %w", err)
		}
		opts.Settings["additional_table_filters"] = FormatClickhouseMap(filters.SqlStringForAllTables(schema.Tables))

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

		// adjust bucketing in query
		q, bucketSizeMs := querying2.Bucketing.AdjustBucketSizeInQuery(query, resolvedTimeRange)
		query = q
		if bucketSizeMs != nil {
			w.Header().Add("X-Dashica-Bucket-Size", fmt.Sprintf("%d", *bucketSizeMs))
		}
	}

	err = client.QueryToHandler(r.Context(), query, opts, w)
	if err != nil {
		return fmt.Errorf("clickhouse query: %w", err)
	}

	return nil
}
