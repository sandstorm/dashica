package httpserver

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/rs/zerolog"
	"github.com/sandstorm/dashica/lib/clickhouse"
	"github.com/sandstorm/dashica/server/querying"
)

type QueryHandler struct {
	ClickhouseClientManager *clickhouse.Manager
	Logger                  zerolog.Logger
	FileSystem              fs.ReadFileFS
}

type DashboardFilters struct {
	TimeRange       string `json:"timeRange"`
	CustomTimeRange string `json:"customTimeRange"`
	SqlFilter       string `json:"sqlFilter"`
}

func (f DashboardFilters) SqlStringForAllTables(tables []string) map[string]string {
	result := make(map[string]string)

	for _, table := range tables {
		queryParts := make([]string, 0, 3)

		queryParts = append(queryParts, "timestamp >= ("+strconv.FormatInt(f.From().UnixMilli(), 10)+")")
		queryParts = append(queryParts, "timestamp <= ("+strconv.FormatInt(f.To().UnixMilli(), 10)+")")

		if f.SqlFilter != "" {
			queryParts = append(queryParts, "("+f.SqlFilter+")")
		}
		result[table] = strings.Join(queryParts, " AND ")
	}

	return result
}

// Unix Timestamp with microsecond precision
func (f DashboardFilters) From() time.Time {
	if f.TimeRange != "custom" {
		// TODO ERROR HDL HERE
		dur, _ := time.ParseDuration(f.TimeRange)
		return time.Now().Add(-dur)
	}

	// TODO: parse custom times
	return time.Now()
}

// Unix Timestamp with microsecond precision
func (f DashboardFilters) To() time.Time {
	if f.TimeRange != "custom" {
		return time.Now()
	}

	// TODO: parse custom times
	return time.Now()
}

// ResolveTimeRange calculates the actual time range as seen by the database, such that the charts
// can display the full range; and returns it as JSON string.
func (f DashboardFilters) ResolveTimeRange() (string, error) {
	timeRange := &querying.TimeRange{
		From: intPtr(f.From().UnixMilli()),
		To:   intPtr(f.To().UnixMilli()),
	}

	resultJson, err := json.Marshal(timeRange)
	if err != nil {
		return "", fmt.Errorf("JSON marshalling: %w", err)
	}
	return string(resultJson), nil
}

func intPtr(i int64) *int64 {
	return &i
}

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
		schema, err := client.IntrospectSchema(r.Context())
		if err != nil {
			return fmt.Errorf("introspecting schema: %w", err)
		}
		opts.Settings["additional_table_filters"] = formatClickhouseMap(filters.SqlStringForAllTables(schema.Tables))

		// add resolved time range to response, so that charts also show the full range if they have no data at beginning or end
		opts.Parameters["__from"] = fmt.Sprintf("%d", filters.From().UnixMilli())
		opts.Parameters["__to"] = fmt.Sprintf("%d", filters.To().UnixMilli())

		resolvedTimeRangeJson, err := filters.ResolveTimeRange()
		if err != nil {
			return fmt.Errorf("JSON marshalling: %w", err)
		}
		w.Header().Add("X-Dashica-Resolved-Time-Range", string(resolvedTimeRangeJson))

		// adjust bucketing in query
		// TODO REIMPL ME
		/*q, bucketSizeMs := querying.Bucketing.AdjustBucketSizeInQuery(query, resolvedTimeRange)
		query = q
		if bucketSizeMs != nil {
			w.Header().Add("X-Dashica-Bucket-Size", fmt.Sprintf("%d", *bucketSizeMs))
		}*/
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
