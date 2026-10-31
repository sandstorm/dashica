package widget

import (
	"cmp"
	"encoding/json"
	"errors"
	"fmt"
	"iter"
	"maps"
	"net/http"
	"path"
	"slices"
	"strconv"
	"strings"

	"github.com/sandstorm/dashica/lib/dashboard/filter"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
	"github.com/sandstorm/dashica/lib/httpserver"
	"github.com/sandstorm/dashica/lib/util/handler_collector"
)

// Widgets is an ordered list of child widgets, e.g. inside a CollapsibleGroup.
type Widgets []WidgetDefinition

// WidgetsMap maps an area/slot name to its widget, e.g. Grid's named areas.
type WidgetsMap map[string]WidgetDefinition

// WidgetDefinition is a widget of a page: what it has beyond its props it implements as withQuery, withHandler and
// withChildren, and Mount describes it for page.json by the type it is registered as (Register).
type WidgetDefinition interface{}

// withProps is a widget's props in page.json, its fields tagged `dashica-gen:"client"` and what its computeProps
// computes when the page is mounted (a markdown's HTML): dashica-gen generates marshalProps for every registered widget.
type withProps interface {
	marshalProps(ctx *rendering.DashboardContext) ([]byte, error)
}

// withQuery is a chart: Mount serves the query it runs, with its own selects and limits, at "/query" (the data,
// Arrow) and "/debug" (the query, EXPLAIN), and for the Explore view at "/rows" and "/sql" (the query as text, which
// the viewer edits).
type withQuery interface {
	Query() sql.SqlQueryable
}

// withDimensions is a chart's own fields, those of them that hold categories the fields it makes pills of (by
// alias, "/pill"): the slots tagged `dashica-gen:"role=dimension"` that are set (generated), a table's GROUP BY or
// select fields.
type withDimensions interface {
	dimensions() []sql.SqlField
}

// withHandler is a widget with data beyond a query (alerts, Speedscope, the schema table): its handler answers the
// requests below its URL ("/viewer/index.html", "/schema").
type withHandler interface {
	Handler(deps rendering.Dependencies) http.Handler
}

// withChildren is a widget that lays out other widgets: a grid's areas by name, a group's widgets by position.
type withChildren interface {
	Children() iter.Seq2[string, WidgetDefinition]
}

// withTitle is a widget with a title (a chart's, a group's): dashica-gen generates widgetTitle from its field `title`.
type withTitle interface {
	widgetTitle() string
}

// withExplicitId is a widget whose author may choose its id (`.Id("shop_revenue_stats")`), so its URL stays
// the same as the page changes.
type withExplicitId interface {
	explicitId() string
}

// Node describes a mounted widget in page.json: its type, its props (its fields tagged `dashica-gen:"client"` and what
// its computeProps computes), the URL of its handler, and its children.
type Node struct {
	Type  string          `json:"type"`
	Props json.RawMessage `json:"props"`
	// DataURL is where its handler answers ("/p/shop/api/3": /query, /debug, /rows and /sql below it); empty for a
	// widget without data.
	DataURL string `json:"dataUrl,omitempty"`
	// RowsURL is where the Explore view's rows of it answer ("/p/shop/api/3/rows": its result, `?xsql=` an edited
	// query); empty for a widget without a query.
	RowsURL string `json:"rowsUrl,omitempty"`
	// Filterable are the aliases of its fields a click may filter by, each a pill on its table (`<dataUrl>/pill`): its
	// fields that hold categories (sql.IsCategory), when its query has a table (sql.From, sql.Table) and does not skip
	// filters; empty for every other widget.
	Filterable []string `json:"filterable,omitempty"`
	// Children by name: a grid's areas; a collapsible group's widgets as "0", "1", ….
	Children map[string]Node `json:"children,omitempty"`
	// Title is its title for the page's outline (Outline); in page.json it is in its props.
	Title string `json:"-"`
}

// Mount is the Node of `w` for page.json. A withQuery or withHandler gets its DataHandler mounted at
// "<page>/api/<id>/" below `api`, the id chosen by its author (`.Id(…)`) or else the page's next
// (ctx.WidgetHandlers), and that URL as its DataURL; a withChildren's children are mounted the same way, in the order
// it yields them.
func Mount(ctx *rendering.DashboardContext, api handler_collector.HandlerCollector, w WidgetDefinition) (Node, error) {
	typ, err := typeName(w)
	if err != nil {
		return Node{}, err
	}
	described, ok := w.(withProps)
	if !ok {
		return Node{}, fmt.Errorf("%s has no marshalProps: run go generate", typ)
	}
	props, err := described.marshalProps(ctx)
	if err != nil {
		return Node{}, fmt.Errorf("%s: marshalling props: %w", typ, err)
	}
	node := Node{Type: typ, Props: props}
	if titled, ok := w.(withTitle); ok {
		node.Title = titled.widgetTitle()
	}
	if data := DataHandler(ctx.Deps, w); data != nil {
		id := ""
		if chosen, ok := w.(withExplicitId); ok {
			id = chosen.explicitId()
		}
		own := ctx.WidgetHandlers(api, w, id)
		if err := own.Handle("/", http.StripPrefix(own.Path(), data)); err != nil {
			return Node{}, fmt.Errorf("%s: %w", typ, err)
		}
		node.DataURL = own.Path()
		if chart, ok := w.(withQuery); ok {
			node.RowsURL = own.Path() + "/rows"
			for _, field := range filterableFields(chart) {
				node.Filterable = append(node.Filterable, field.Alias())
			}
		}
	}
	if container, ok := w.(withChildren); ok {
		node.Children = map[string]Node{}
		for name, child := range container.Children() {
			if node.Children[name], err = Mount(ctx, api, child); err != nil {
				return Node{}, fmt.Errorf("%s '%s': %w", typ, name, err)
			}
		}
	}
	return node, nil
}

// Outline is the charts among `nodes` and their children, in the order they were mounted: the widgets with data and a
// title, each with the title of the collapsible group around it.
func Outline(nodes []Node) []rendering.OutlineEntry {
	return outline(nodes, "")
}

// outline is Outline inside the collapsible group titled `group` ("" outside one).
func outline(nodes []Node, group string) []rendering.OutlineEntry {
	entries := []rendering.OutlineEntry{}
	for _, node := range nodes {
		if node.DataURL != "" && node.Title != "" {
			entries = append(entries, rendering.OutlineEntry{Id: path.Base(node.DataURL), Title: node.Title, Group: group})
		}
		inner := group
		if node.Type == "collapsibleGroup" {
			inner = node.Title
		}
		entries = append(entries, outline(mountOrder(node.Children), inner)...)
	}
	return entries
}

// mountOrder is `children` in the order Mount mounted them: a group's by position ("2" before "10"), a grid's by name.
func mountOrder(children map[string]Node) []Node {
	names := slices.SortedFunc(maps.Keys(children), func(a, b string) int {
		i, errA := strconv.Atoi(a)
		j, errB := strconv.Atoi(b)
		if errA == nil && errB == nil {
			return cmp.Compare(i, j)
		}
		return strings.Compare(a, b)
	})
	ordered := make([]Node, len(names))
	for i, name := range names {
		ordered[i] = children[name]
	}
	return ordered
}

// Mount mounts each widget below `api`; the nodes keep the order.
func (w Widgets) Mount(ctx *rendering.DashboardContext, api handler_collector.HandlerCollector) ([]Node, error) {
	nodes := make([]Node, 0, len(w))
	for _, child := range w {
		node, err := Mount(ctx, api, child)
		if err != nil {
			return nil, err
		}
		nodes = append(nodes, node)
	}
	return nodes, nil
}

// all yields the widgets by position: "0", "1", ….
func (w Widgets) all() iter.Seq2[string, WidgetDefinition] {
	return func(yield func(string, WidgetDefinition) bool) {
		for i, child := range w {
			if !yield(strconv.Itoa(i), child) {
				return
			}
		}
	}
}

// all yields the widgets by name, sorted, so the ids stay the same from one start to the next.
func (w WidgetsMap) all() iter.Seq2[string, WidgetDefinition] {
	return func(yield func(string, WidgetDefinition) bool) {
		for _, name := range slices.Sorted(maps.Keys(w)) {
			if !yield(name, w[name]) {
				return
			}
		}
	}
}

// DataHandler answers the requests below a widget's URL: a withQuery's query (queryHandler), a withHandler's Handler;
// nil for a widget without data.
func DataHandler(deps rendering.Dependencies, w WidgetDefinition) http.Handler {
	if chart, ok := w.(withQuery); ok {
		return queryHandler(deps, chart)
	}
	if data, ok := w.(withHandler); ok {
		return data.Handler(deps)
	}
	return nil
}

// queryHandler serves the query of `chart`: /query (the data, Arrow), /debug (the query, EXPLAIN), /rows (the
// Explore view's rows in plain Arrow types, HandleRows: the chart's result; with `?xsql=<text>` the query the viewer
// edited, HandleEditedRows, at most exploreRowLimit rows) and /sql (the chart's query with its parameters written in,
// HandleSql), each with the pills of the request on its table (filter.Apply; a pill not signed with
// deps.FilterSecret is a 400, as is a query state that cannot be read); and /pill, the pill of one of its fields
// (pillHandler). /sql and `xsql` are behind the Explore gate (editable on deps.ExploreEnabled).
func queryHandler(deps rendering.Dependencies, chart withQuery) http.Handler {
	qh := httpserver.QueryHandler{
		ClickhouseClientManager: deps.ClickhouseClientManager,
		Logger:                  deps.Logger,
		FileSystem:              deps.FileSystem,
	}
	query := chart.Query()
	serve := func(handle func(sql.SqlQueryable, httpserver.QueryState, filter.Diagnostics, http.ResponseWriter, *http.Request) error) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			state, err := httpserver.ParseQueryState(r)
			if err != nil {
				httpError(w, err)
				return
			}
			pills, err := openPills(deps.FilterSecret, state.Pills)
			if err != nil {
				httpError(w, err)
				return
			}
			table, ok := tableOf(deps, query)
			filtered, diagnostics := filter.Apply(query, table, ok, pills)
			httpError(w, handle(filtered, state, diagnostics, w, r))
		}
	}
	rows := serve(qh.HandleRows)
	mux := http.NewServeMux()
	mux.Handle("/query", serve(qh.HandleQuery))
	mux.Handle("/debug", serve(qh.HandleDebug))
	mux.Handle("/rows", editable(deps.ExploreEnabled, edited, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if edited(r) {
			httpError(w, qh.HandleEditedRows(query, r.URL.Query().Get("xsql"), exploreRowLimit, w, r))
			return
		}
		rows(w, r)
	})))
	mux.Handle("/sql", editable(deps.ExploreEnabled, always, serve(qh.HandleSql)))
	mux.Handle("/pill", pillHandler(deps, chart))
	return mux
}

// pillHandler answers `GET /pill?field=<alias>&value=<shown value>&op=eq|ne` with the pill (filter.New) of the
// chart's filterable field `field` on its table, as JSON `{key, label}`: its key signed with deps.FilterSecret
// (filter.Sign), its label the chip's text. 422 for a field that cannot filter (none of filterableFields: a count, a
// time bucket, any field of a chart without a table), 400 for a request without `value` or with another op.
func pillHandler(deps rendering.Dependencies, chart withQuery) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		args := r.URL.Query()
		alias, op := args.Get("field"), args.Get("op")
		if !args.Has("value") || (op != "eq" && op != "ne") {
			http.Error(w, "want ?field=<alias>&value=<value>&op=eq|ne", http.StatusBadRequest)
			return
		}
		i := slices.IndexFunc(filterableFields(chart), func(f sql.SqlField) bool { return f.Alias() == alias })
		table, ok := tableOf(deps, chart.Query())
		if i < 0 || !ok {
			http.Error(w, fmt.Sprintf("%q cannot filter this chart's table", alias), http.StatusUnprocessableEntity)
			return
		}
		pill, err := filter.New(table, filterableFields(chart)[i], op, args.Get("value"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusUnprocessableEntity)
			return
		}
		key, err := filter.Sign(deps.FilterSecret, pill)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(struct {
			Key   string `json:"key"`
			Label string `json:"label"`
		}{key, pill.Label})
	}
}

// filterableFields are the fields of `chart` a pill filters by: its dimensions that hold categories, each alias once;
// none when its query has no table or skips filters.
func filterableFields(chart withQuery) []sql.SqlField {
	d, ok := chart.(withDimensions)
	if _, hasTable := sql.TableOf(chart.Query()); !ok || !hasTable || chart.Query().ShouldSkipFilters() {
		return nil
	}
	var fields []sql.SqlField
	for _, field := range d.dimensions() {
		if field != nil && sql.IsCategory(field) && !slices.ContainsFunc(fields, func(f sql.SqlField) bool { return f.Alias() == field.Alias() }) {
			fields = append(fields, field)
		}
	}
	return fields
}

// tableOf is the table whose pills `query` takes (filter.TableOf), a name without database in its connection's
// database from dashica_config.
func tableOf(deps rendering.Dependencies, query sql.SqlQueryable) (filter.Table, bool) {
	return filter.TableOf(query, deps.ClickhouseClientManager.Database)
}

// openPills are the pills of `keys` (filter.Open); a QueryStateError (400) for the first one not signed with `secret`.
func openPills(secret []byte, keys []string) ([]filter.Pill, error) {
	pills := make([]filter.Pill, 0, len(keys))
	for _, key := range keys {
		pill, err := filter.Open(secret, key)
		if err != nil {
			return nil, &httpserver.QueryStateError{Reason: err.Error()}
		}
		pills = append(pills, pill)
	}
	return pills, nil
}

// exploreRowLimit is the number of rows an edited query (/rows?xsql=) answers at most.
const exploreRowLimit = 100_000

// edited: the request asks for the rows of the query the viewer edited (`?xsql=<text>`).
func edited(r *http.Request) bool {
	return r.URL.Query().Has("xsql")
}

func always(*http.Request) bool { return true }

// editable is `handler` behind the Explore gate: with `explore` each answer says `X-Dashica-Sql: editable` (the
// view offers its SQL editor); without, a request that `needs` it is a 404 before any query.
func editable(explore bool, needs func(*http.Request) bool, handler http.Handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !explore && needs(r) {
			http.Error(w, "Explore is not enabled (explore.enabled)", http.StatusNotFound)
			return
		}
		if explore {
			w.Header().Set("X-Dashica-Sql", "editable")
		}
		handler.ServeHTTP(w, r)
	}
}

// httpError answers `err`: 400 for a query state that cannot be read, else 500; nothing for nil.
func httpError(w http.ResponseWriter, err error) {
	if err == nil {
		return
	}
	status := http.StatusInternalServerError
	var bad *httpserver.QueryStateError
	if errors.As(err, &bad) {
		status = http.StatusBadRequest
	}
	http.Error(w, err.Error(), status)
}
