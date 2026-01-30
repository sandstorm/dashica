package httpserver

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"strings"
	"time"

	"github.com/rs/zerolog"
	"github.com/sandstorm/dashica/lib/clickhouse"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
	querying2 "github.com/sandstorm/dashica/lib/httpserver/querying"
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

	// LEGACY; WAS SENT FROM UI
	From interface{}
	To   interface{}
}

func (f *DashboardFilters) SqlStringForAllTables(tables []string) map[string]string {
	result := make(map[string]string)
	f.calculateLegacyFilters()

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

// Unix Timestamp with microsecond precision
func (f *DashboardFilters) FromNew() time.Time {
	if f.TimeRange != "custom" {
		// TODO ERROR HDL HERE
		dur, _ := time.ParseDuration(f.TimeRange)
		return time.Now().Add(-dur)
	}

	// TODO: parse custom times
	return time.Now()
}

// Unix Timestamp with microsecond precision
func (f *DashboardFilters) ToNew() time.Time {
	if f.TimeRange != "custom" {
		return time.Now()
	}

	// TODO: parse custom times
	return time.Now()
}

// ResolveTimeRangeFromDb calculates the actual time range as seen by the database, such that the charts
// can display the full range; and returns it as JSON string.
func (f *DashboardFilters) ResolveTimeRangeFromDb(ctx context.Context, clickhouseClient *clickhouse.Client) (string, error) {
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
func (f *DashboardFilters) ResolveTimeRangeFromDbAsTime(ctx context.Context, clickhouseClient *clickhouse.Client) (*querying2.TimeRange, error) {
	query := ""
	f.calculateLegacyFilters()

	fromStr, fromOk := f.From.(string)
	toStr, toOk := f.To.(string)

	fromInt, fromIntOk := f.From.(float64)
	toInt, toIntOk := f.To.(float64)

	if fromOk && fromStr != "" && toOk && toStr != "" {
		query = fmt.Sprintf(`SELECT (%s)::Int64 * 1000 as from, (%s)::Int64 * 1000 as to`, fromStr, toStr)
	} else if toIntOk && fromIntOk {
		return &querying2.TimeRange{
			From: intPtr(int64(fromInt) * 1000),
			To:   intPtr(int64(toInt) * 1000),
		}, nil
	} else {
		return nil, fmt.Errorf("no time range given")
	}

	opts := clickhouse.DefaultQueryOptions()
	opts.Settings["output_format_json_quote_decimals"] = "0"
	opts.Settings["output_format_json_quote_64bit_integers"] = "0"
	opts.Settings["output_format_json_quote_64bit_floats"] = "0"
	result, err := clickhouse.QueryJSONFirst[querying2.TimeRange](ctx, clickhouseClient, query, opts)
	if err != nil {
		return nil, fmt.Errorf("SQL query: %w", err)
	}
	return result, nil
}

func (f *DashboardFilters) calculateLegacyFilters() {
	if f.TimeRange == "custom" {
		// TODO: IMPL ME FOR LEGACY SUPPORT
	} else if f.TimeRange == "5m" {
		f.From = "now() - INTERVAL 5 MINUTE"
		f.To = "now()"
	} else if f.TimeRange == "15m" {
		f.From = "now() - INTERVAL 15 MINUTE"
		f.To = "now()"
	} else if f.TimeRange == "1h" {
		f.From = "now() - INTERVAL 1 HOUR"
		f.To = "now()"
	} else if f.TimeRange == "3h" {
		f.From = "now() - INTERVAL 3 HOUR"
		f.To = "now()"
	} else if f.TimeRange == "6h" {
		f.From = "now() - INTERVAL 6 HOUR"
		f.To = "now()"
	} else if f.TimeRange == "12h" {
		f.From = "now() - INTERVAL 12 HOUR"
		f.To = "now()"
	} else if f.TimeRange == "24h" {
		f.From = "now() - INTERVAL 1 DAY"
		f.To = "now()"
	} else if f.TimeRange == "48h" {
		f.From = "now() - INTERVAL 2 DAY"
		f.To = "now()"
	} else if f.TimeRange == "168h" {
		f.From = "now() - INTERVAL 7 DAY"
		f.To = "now()"
	} else if f.TimeRange == "720h" {
		f.From = "now() - INTERVAL 30 DAY"
		f.To = "now()"
	}

}

func intPtr(i int64) *int64 {
	return &i
}

func (qh QueryHandler) HandleQuery(queryObj sql.SqlQueryable, w http.ResponseWriter, r *http.Request) error {
	println("!!!!!!!!!!!!!!")
	println(queryObj.Build())
	// TODO: different server support per dashboard
	client, err := qh.ClickhouseClientManager.GetClient("default")
	if err != nil {
		return fmt.Errorf("get clickhouse client: %w", err)
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

	query := queryObj.Build()
	rawFilters := r.URL.Query().Get("filters")
	if rawFilters != "" && !queryObj.ShouldSkipFilters() {
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
