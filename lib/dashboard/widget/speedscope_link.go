package widget

import (
	"fmt"
	"io/fs"
	"maps"
	"net/http"
	"time"

	"github.com/sandstorm/dashica/lib/clickhouse"
	"github.com/sandstorm/dashica/lib/dashboard/filter"
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
		httpError(w, serveSpeedscope(query, deps, w, r))
	})
	mux.Handle("/viewer/", http.StripPrefix("/viewer", http.FileServerFS(speedscopeViewer)))
	return mux
}

func (s *SpeedscopeLink) explicitId() string { return s.id }

// serveSpeedscope runs the query and streams the result as space-delimited CSV — the format
// Speedscope's profileURL ingestor expects. It takes the page's filters as a chart does: the window, the SQL chips
// and the pills on its table and of the filter buttons (filter.Apply); a pill not signed with filters.secret, or a SQL
// chip while filters.sqlEnabled is off, is a 400.
func serveSpeedscope(query sql.SqlQueryable, deps rendering.Dependencies, w http.ResponseWriter, r *http.Request) error {
	client, err := deps.ClickhouseClientManager.GetClient("default")
	if err != nil {
		return fmt.Errorf("get clickhouse client: %w", err)
	}

	opts := clickhouse.DefaultQueryOptions()
	opts.Format = "CSV"
	opts.Settings["format_custom_field_delimiter"] = " "
	opts.Settings["date_time_input_format"] = "best_effort"

	state, err := httpserver.ParseQueryState(r)
	if err != nil {
		return err
	}
	maps.Copy(opts.Parameters, state.Params)
	pills, err := openPills(deps, state.Pills)
	if err != nil {
		return err
	}
	table, ok := deps.FilterService.TableOf(query)
	query, _ = filter.Apply(query, table, ok, pills)

	q := query
	if !query.ShouldSkipFilters() {
		resolvedTimeRange, err := state.ResolveTimeRange(time.Now())
		if err != nil {
			return err
		}
		clause, err := state.SqlClause(resolvedTimeRange, deps.Config.Filters)
		if err != nil {
			return err
		}
		q = query.With(sql.Where(clause))
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
