package httpserver

import (
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net/http"
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
}

func (qh QueryHandler) HandleQuery(queryObj sql.SqlQueryable, w http.ResponseWriter, r *http.Request) error {
	serverId := queryObj.Database()
	if serverId == "" {
		serverId = "default"
	}
	client, err := qh.ClickhouseClientManager.GetClient(serverId)
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

	rawFilters := r.URL.Query().Get("filters")
	q := queryObj
	var resolvedTimeRange *querying2.TimeRange
	if rawFilters != "" && !queryObj.ShouldSkipFilters() {
		var filters DashboardFilters
		err = json.Unmarshal([]byte(rawFilters), &filters)
		if err != nil {
			return fmt.Errorf("unmarshalling filters: %w", err)
		}
		resolvedTimeRange, err = filters.ResolveTimeRange(time.Now())
		if err != nil {
			return err
		}
		q = queryObj.With(sql.Where(filters.SqlClause(resolvedTimeRange)))
		opts.Parameters["__from"] = fmt.Sprintf("%d", *resolvedTimeRange.From/1000)
		opts.Parameters["__to"] = fmt.Sprintf("%d", *resolvedTimeRange.To/1000)
		// so that charts also show the full range if they have no data at beginning or end
		WriteResolvedTimeRange(w, resolvedTimeRange)
	}

	var bucketSizeMs *int64
	if resolvedTimeRange != nil {
		q, bucketSizeMs = q.AdjustBuckets(resolvedTimeRange.WidthS())
	}
	query, err := sql.BuildWithFS(q, qh.FileSystem)
	if err != nil {
		return fmt.Errorf("building SQL query: %w", err)
	}
	if bucketSizeMs != nil {
		w.Header().Add("X-Dashica-Bucket-Size", fmt.Sprintf("%d", *bucketSizeMs))
	}

	err = client.QueryToHandler(r.Context(), query, opts, w)
	if err != nil {
		return fmt.Errorf("clickhouse query: %w", err)
	}

	return nil
}

type DebugInfo struct {
	Query               string                 `json:"query"`
	ExplainPlan         string                 `json:"explainPlan"`
	ExplainPipeline     string                 `json:"explainPipeline"`
	ExplainPipelineText string                 `json:"explainPipelineText"`
	ExplainSyntax       string                 `json:"explainSyntax"`
	Stats               map[string]interface{} `json:"stats"`
}

// HandleDebug returns debug information about the query including the SQL string and EXPLAIN output
func (qh QueryHandler) HandleDebug(queryObj sql.SqlQueryable, w http.ResponseWriter, r *http.Request) error {
	serverId := queryObj.Database()
	if serverId == "" {
		serverId = "default"
	}
	client, err := qh.ClickhouseClientManager.GetClient(serverId)
	if err != nil {
		return fmt.Errorf("get clickhouse client: %w", err)
	}

	opts := clickhouse.DefaultQueryOptions()
	opts.Settings["date_time_input_format"] = "best_effort" // support ISO 8601 dates

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
	q := queryObj
	var resolvedTimeRange *querying2.TimeRange

	debugInfo := DebugInfo{
		Stats: make(map[string]interface{}),
	}

	if rawFilters != "" && !queryObj.ShouldSkipFilters() {
		var filters DashboardFilters
		err = json.Unmarshal([]byte(rawFilters), &filters)
		if err != nil {
			return fmt.Errorf("unmarshalling filters: %w", err)
		}
		resolvedTimeRange, err = filters.ResolveTimeRange(time.Now())
		if err != nil {
			return err
		}
		filterClause := filters.SqlClause(resolvedTimeRange)
		q = queryObj.With(sql.Where(filterClause))
		opts.Parameters["__from"] = fmt.Sprintf("%d", *resolvedTimeRange.From/1000)
		opts.Parameters["__to"] = fmt.Sprintf("%d", *resolvedTimeRange.To/1000)

		debugInfo.Stats["resolvedTimeRange"] = resolvedTimeRange
		debugInfo.Stats["filterClause"] = filterClause
	}

	var bucketSizeMs *int64
	if resolvedTimeRange != nil {
		q, bucketSizeMs = q.AdjustBuckets(resolvedTimeRange.WidthS())
	}
	query, err := sql.BuildWithFS(q, qh.FileSystem)
	if err != nil {
		return fmt.Errorf("building SQL query: %w", err)
	}
	if bucketSizeMs != nil {
		debugInfo.Stats["bucketSizeMs"] = *bucketSizeMs
	}

	debugInfo.Query = query

	// Helper function to execute EXPLAIN variants
	executeExplain := func(explainQuery string) string {
		explainOpts := clickhouse.DefaultQueryOptions()
		explainOpts.Format = "TSVRaw" // Plain text format
		explainOpts.Parameters = opts.Parameters
		// Copy settings from original query
		for k, v := range opts.Settings {
			explainOpts.Settings[k] = v
		}

		resp, err := client.Query(r.Context(), explainQuery, explainOpts)
		if err != nil {
			return fmt.Sprintf("Error: %v", err)
		}
		defer resp.Body.Close()

		body, err := io.ReadAll(resp.Body)
		if err != nil {
			return fmt.Sprintf("Error reading response: %v", err)
		}
		return string(body)
	}

	// Execute different EXPLAIN variants for comprehensive debugging

	// 1. EXPLAIN PLAN - shows the query execution plan with details
	// Options: header=1 (show header), actions=1 (show actions), indexes=1 (show indexes)
	debugInfo.ExplainPlan = executeExplain("EXPLAIN header = 1, actions = 1, indexes = 1 " + query)

	// 2. EXPLAIN PIPELINE - shows the execution pipeline (similar to EXPLAIN ANALYZE)
	// Graph version for visualization
	debugInfo.ExplainPipeline = executeExplain("EXPLAIN PIPELINE graph = 1 " + query)
	// Text version with details about each step
	debugInfo.ExplainPipelineText = executeExplain("EXPLAIN PIPELINE compact = 0 " + query)

	// 3. EXPLAIN SYNTAX - shows the optimized query after all transformations
	debugInfo.ExplainSyntax = executeExplain("EXPLAIN SYNTAX " + query)

	// Return as JSON
	w.Header().Set("Content-Type", "application/json")
	return json.NewEncoder(w).Encode(debugInfo)
}
