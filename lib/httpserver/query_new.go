package httpserver

import (
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"maps"
	"net/http"
	"time"

	"github.com/rs/zerolog"
	"github.com/sandstorm/dashica/lib/clickhouse"
	"github.com/sandstorm/dashica/lib/dashboard/filter"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
	querying2 "github.com/sandstorm/dashica/lib/httpserver/querying"
)

type QueryHandler struct {
	ClickhouseClientManager *clickhouse.Manager
	Logger                  zerolog.Logger
	FileSystem              fs.ReadFileFS
}

// HandleQuery answers `queryObj` as Arrow, filtered by `state` (ParseQueryState of `r`): its window and its SQL
// filter; `queryObj` has the structured filters its chart interprets already, and `diagnostics` says what it did
// (X-Dashica-Diagnostics). Every filter's value is bound (filter.Param). A skipped chart answers 204 without asking
// ClickHouse. An unreadable custom range is ResolveTimeRange's error.
func (qh QueryHandler) HandleQuery(queryObj sql.SqlQueryable, state QueryState, diagnostics filter.Diagnostics, w http.ResponseWriter, r *http.Request) error {
	return qh.answerArrow(queryObj, state, diagnostics, nil, w, r)
}

// answerArrow is HandleQuery with `cast` as the Arrow query's QueryOptions.Cast.
func (qh QueryHandler) answerArrow(queryObj sql.SqlQueryable, state QueryState, diagnostics filter.Diagnostics, cast func(column, columnType string) string, w http.ResponseWriter, r *http.Request) error {
	WriteDiagnostics(w, diagnostics)
	if diagnostics.Skipped != "" {
		w.WriteHeader(http.StatusNoContent)
		return nil
	}
	p, err := qh.prepare(queryObj, state)
	if err != nil {
		return err
	}
	p.opts.Settings["output_format_arrow_compression_method"] = "none" // compression not supported by arrow JS
	p.opts.Cast = cast
	p.writeHeaders(w)
	if err := p.client.QueryToHandler(r.Context(), p.query, p.opts, w); err != nil {
		return fmt.Errorf("clickhouse query: %w", err)
	}
	return nil
}

// prepared is a query as a handler sends it to ClickHouse: its client, its SQL with the window and SQL filter of the
// request and its auto buckets rebaked, its options with the parameters bound.
type prepared struct {
	client *clickhouse.Client
	query  string
	opts   clickhouse.QueryOptions
	// timeRange is the resolved window, nil for a query that skips filters; filterClause its WHERE
	timeRange    *querying2.TimeRange
	filterClause string
	// bucketSizeMs is the size of its auto buckets, nil without
	bucketSizeMs *int64
}

// prepare is `queryObj` filtered by `state` as HandleQuery, HandleRows and HandleDebug send it: its window and SQL
// filter unless it skips filters, the form values and every filter's value bound.
func (qh QueryHandler) prepare(queryObj sql.SqlQueryable, state QueryState) (prepared, error) {
	serverId := queryObj.Database()
	if serverId == "" {
		serverId = "default"
	}
	client, err := qh.ClickhouseClientManager.GetClient(serverId)
	if err != nil {
		return prepared{}, fmt.Errorf("get clickhouse client: %w", err)
	}
	p := prepared{client: client, opts: clickhouse.DefaultQueryOptions()}
	p.opts.Settings["date_time_input_format"] = "best_effort" // support ISO 8601 dates (which is used in date picker by browser)

	maps.Copy(p.opts.Parameters, state.Params)
	bindFilters(p.opts.Parameters, state)

	q := queryObj
	if !queryObj.ShouldSkipFilters() {
		if p.timeRange, err = state.ResolveTimeRange(time.Now()); err != nil {
			return prepared{}, err
		}
		p.filterClause = state.SqlClause(p.timeRange)
		q = queryObj.With(sql.Where(p.filterClause))
		p.opts.Parameters["__from"] = fmt.Sprintf("%d", *p.timeRange.From/1000)
		p.opts.Parameters["__to"] = fmt.Sprintf("%d", *p.timeRange.To/1000)
		q, p.bucketSizeMs = q.AdjustBuckets(p.timeRange.WidthS())
	}
	if p.query, err = sql.BuildWithFS(q, qh.FileSystem); err != nil {
		return prepared{}, fmt.Errorf("building SQL query: %w", err)
	}
	return p, nil
}

// writeHeaders tells the client the window (so that charts also show the full range if they have no data at
// beginning or end) and the bucket size, each when there is one.
func (p prepared) writeHeaders(w http.ResponseWriter) {
	if p.timeRange != nil {
		WriteResolvedTimeRange(w, p.timeRange)
	}
	if p.bucketSizeMs != nil {
		w.Header().Add("X-Dashica-Bucket-Size", fmt.Sprintf("%d", *p.bucketSizeMs))
	}
}

type DebugInfo struct {
	Query               string                 `json:"query"`
	ExplainPlan         string                 `json:"explainPlan"`
	ExplainPipeline     string                 `json:"explainPipeline"`
	ExplainPipelineText string                 `json:"explainPipelineText"`
	ExplainSyntax       string                 `json:"explainSyntax"`
	Stats               map[string]interface{} `json:"stats"`
}

// HandleDebug returns debug information about the query including the SQL string and EXPLAIN output, filtered as
// HandleQuery filters it; Stats has the window and SQL filter clause, the bound parameters and `diagnostics`. A
// skipped chart answers its Stats alone, without asking ClickHouse.
func (qh QueryHandler) HandleDebug(queryObj sql.SqlQueryable, state QueryState, diagnostics filter.Diagnostics, w http.ResponseWriter, r *http.Request) error {
	WriteDiagnostics(w, diagnostics)
	debugInfo := DebugInfo{
		Stats: map[string]interface{}{"diagnostics": diagnostics},
	}
	if diagnostics.Skipped != "" {
		w.Header().Set("Content-Type", "application/json")
		return json.NewEncoder(w).Encode(debugInfo)
	}
	p, err := qh.prepare(queryObj, state)
	if err != nil {
		return err
	}
	client, query, opts := p.client, p.query, p.opts
	if p.timeRange != nil {
		debugInfo.Stats["resolvedTimeRange"] = p.timeRange
		debugInfo.Stats["filterClause"] = p.filterClause
	}
	debugInfo.Stats["parameters"] = opts.Parameters
	if p.bucketSizeMs != nil {
		debugInfo.Stats["bucketSizeMs"] = *p.bucketSizeMs
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

// bindFilters adds the value of each of the request's filters to `params` (`__f0`, …), also of those its chart
// ignores, so a chart's conditions name only filter.Param.
func bindFilters(params map[string]string, state QueryState) {
	for i, f := range state.Filters {
		params[filter.Param(i)] = f.Value
	}
}
