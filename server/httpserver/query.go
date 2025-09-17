package httpserver

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/rs/zerolog"
	"github.com/sandstorm/dashica/server/clickhouse"
	"github.com/sandstorm/dashica/server/querying"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

type queryHandler struct {
	clickhouseClientManager *clickhouse.Manager
	logger                  zerolog.Logger
	fileSystem              fs.ReadFileFS
}

type DashboardFilters struct {
	From      any    `json:"from"`
	To        any    `json:"to"`
	SqlFilter string `json:"sqlFilter"`
}

func (f DashboardFilters) SqlStringForAllTables(tables []string) map[string]string {
	result := make(map[string]string)

	for _, table := range tables {
		queryParts := make([]string, 0, 3)

		if fromStr, ok := f.From.(string); ok && fromStr != "" {
			queryParts = append(queryParts, "timestamp >= ("+fromStr+")")
		}
		if fromFloat, ok := f.From.(float64); ok && fromFloat != 0 {
			queryParts = append(queryParts, fmt.Sprintf("timestamp >= %d", int64(fromFloat)))
		}
		if toStr, ok := f.To.(string); ok && toStr != "" {
			queryParts = append(queryParts, "timestamp <= ("+toStr+")")
		}
		if toFloat, ok := f.To.(float64); ok && toFloat != 0 {
			queryParts = append(queryParts, fmt.Sprintf("timestamp <= %d", int64(toFloat)))
		}
		if f.SqlFilter != "" {
			queryParts = append(queryParts, "("+f.SqlFilter+")")
		}
		result[table] = strings.Join(queryParts, " AND ")
	}

	return result
}

// ResolveTimeRangeFromDb calculates the actual time range as seen by the database, such that the charts
// can display the full range; and returns it as JSON string.
func (f DashboardFilters) ResolveTimeRangeFromDb(ctx context.Context, clickhouseClient *clickhouse.Client) (string, error) {
	result, err := f.ResolveTimeRangeFromDbAsTime(ctx, clickhouseClient)
	if err != nil {
		return "", err
	}

	resultJson, err := json.Marshal(result)
	if err != nil {
		return "", fmt.Errorf("JSON marshalling: %w", err)
	}
	return string(resultJson), nil
}

// ResolveTimeRangeFromDbAsTime calculates the actual time range as seen by the database, such that the charts
// can display the full range; and returns it as JSON string.
func (f DashboardFilters) ResolveTimeRangeFromDbAsTime(ctx context.Context, clickhouseClient *clickhouse.Client) (*querying.TimeRange, error) {
	query := ""

	fromStr, fromOk := f.From.(string)
	toStr, toOk := f.To.(string)

	fromInt, fromIntOk := f.From.(float64)
	toInt, toIntOk := f.To.(float64)

	if fromOk && fromStr != "" && toOk && toStr != "" {
		query = fmt.Sprintf(`SELECT (%s)::Int64 * 1000 as from, (%s)::Int64 * 1000 as to`, fromStr, toStr)
	} else if toIntOk && fromIntOk {
		return &querying.TimeRange{
			From: intPtr(int64(fromInt) * 1000),
			To:   intPtr(int64(toInt) * 1000),
		}, nil
	} else {
		return nil, nil
	}

	opts := clickhouse.DefaultQueryOptions()
	opts.Settings["output_format_json_quote_decimals"] = "0"
	opts.Settings["output_format_json_quote_64bit_integers"] = "0"
	opts.Settings["output_format_json_quote_64bit_floats"] = "0"
	result, err := clickhouse.QueryJSONFirst[querying.TimeRange](ctx, clickhouseClient, query, opts)
	if err != nil {
		return nil, fmt.Errorf("SQL query: %w", err)
	}
	return result, nil
}

func intPtr(i int64) *int64 {
	return &i
}

func (qh queryHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) error {
	fileName := r.URL.Query().Get("fileName")
	if fileName == "" {
		return fmt.Errorf("missing required 'fileName' parameter")
	}

	basePath := "client/"
	filePath := path.Clean(path.Join(basePath, fileName))
	if !strings.HasPrefix(filePath, basePath) {
		return fmt.Errorf("invalid file path: %s", filePath)
	}
	fileContent, err := qh.fileSystem.ReadFile(filePath)
	if err != nil {
		return fmt.Errorf("reading file %s: %w", fileName, err)
	}

	client, err := qh.clickhouseClientManager.GetClientForSqlFile(fileName)
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

		// adjust bucketing in query
		q, bucketSizeMs := querying.Bucketing.AdjustBucketSizeInQuery(query, resolvedTimeRange)
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

// formatClickhouseMap handles the special case of additional_table_filters
func formatClickhouseMap(input map[string]string) string {
	var outputParts []string
	for k, v := range input {
		outputParts = append(outputParts, fmt.Sprintf("'%s': '%s'",
			escapeString(k), escapeString(v)))
	}

	return fmt.Sprintf("{%s}", strings.Join(outputParts, ", "))
}

// escapeString escapes single quotes in strings
func escapeString(s string) string {
	return strings.ReplaceAll(s, "'", "\\'")
}
