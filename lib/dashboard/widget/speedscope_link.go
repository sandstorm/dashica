package widget

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"

	"github.com/sandstorm/dashica/lib/clickhouse"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
	"github.com/sandstorm/dashica/lib/httpserver"
	"github.com/sandstorm/dashica/speedscope_viewer"
)

// SpeedscopeLink renders an "Open Speedscope" link that, when clicked, opens the bundled
// Speedscope flame-graph viewer pointed at this widget's per-instance speedscope-query
// endpoint. The query body is a sql.SqlQueryable just like chart widgets — customer/project
// constants belong in WHERE clauses, user-driven values flow through $store.urlState.widgetParams.
type SpeedscopeLink struct {
	// sql is the query run when the link is clicked, streamed to the
	// bundled Speedscope viewer as space-delimited CSV.
	sql sql.SqlQueryable
	// title is the link's button label. Zero value: "Open Speedscope".
	title string `dashica-gen:"client"`
	// id is the stable widget id (its URL "<page>/api/<id>"); assigned by the page when empty.
	id string
}

func NewSpeedscopeLink(query sql.SqlQueryable) *SpeedscopeLink {
	return &SpeedscopeLink{sql: query}
}

func (s *SpeedscopeLink) Title(title string) *SpeedscopeLink {
	cloned := *s
	cloned.title = title
	return &cloned
}

func (s *SpeedscopeLink) Id(id string) *SpeedscopeLink {
	cloned := *s
	cloned.id = id
	return &cloned
}

func (s *SpeedscopeLink) Handler(deps rendering.Dependencies) http.Handler {
	query := s.sql
	mux := http.NewServeMux()
	mux.HandleFunc("/speedscope-query", func(w http.ResponseWriter, r *http.Request) {
		if err := serveSpeedscope(query, deps, w, r); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
	})
	mux.Handle("/viewer/", http.StripPrefix("/viewer", http.FileServerFS(speedscopeViewer)))
	return mux
}

func (s *SpeedscopeLink) explicitId() string { return s.id }

// serveSpeedscope runs the query and streams the result as space-delimited CSV — the format
// Speedscope's profileURL ingestor expects.
func serveSpeedscope(query sql.SqlQueryable, deps rendering.Dependencies, w http.ResponseWriter, r *http.Request) error {
	client, err := deps.ClickhouseClientManager.GetClient("default")
	if err != nil {
		return fmt.Errorf("get clickhouse client: %w", err)
	}

	opts := clickhouse.DefaultQueryOptions()
	opts.Format = "CSV"
	opts.Settings["format_custom_field_delimiter"] = " "
	opts.Settings["date_time_input_format"] = "best_effort"

	if paramsStr := r.URL.Query().Get("params"); paramsStr != "" {
		var params map[string]string
		if err := json.Unmarshal([]byte(paramsStr), &params); err != nil {
			return fmt.Errorf("unmarshalling params: %w", err)
		}
		opts.Parameters = params
	}

	q := query
	if rawFilters := r.URL.Query().Get("filters"); rawFilters != "" && !query.ShouldSkipFilters() {
		var filters httpserver.DashboardFilters
		if err := json.Unmarshal([]byte(rawFilters), &filters); err != nil {
			return fmt.Errorf("unmarshalling filters: %w", err)
		}
		if clause := filters.SqlClause(); clause != "" {
			q = query.With(sql.Where(clause))
		}
		resolvedTimeRange, err := filters.ResolveTimeRangeFromDbAsTime(r.Context(), client)
		if err != nil {
			return fmt.Errorf("resolving time range: %w", err)
		}
		opts.Parameters["__from"] = fmt.Sprintf("%d", *resolvedTimeRange.From/1000)
		opts.Parameters["__to"] = fmt.Sprintf("%d", *resolvedTimeRange.To/1000)
	}

	queryString, err := sql.BuildWithFS(q, deps.FileSystem)
	if err != nil {
		return fmt.Errorf("building SQL query: %w", err)
	}
	if err := client.QueryToHandler(r.Context(), queryString, opts, w); err != nil {
		return fmt.Errorf("clickhouse query: %w", err)
	}
	return nil
}

// speedscopeViewer is the bundled Speedscope viewer; fs.Sub errs only for an invalid name, which "dist" is not.
var speedscopeViewer, _ = fs.Sub(speedscope_viewer.FS, "dist")
