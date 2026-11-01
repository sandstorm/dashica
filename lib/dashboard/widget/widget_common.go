package widget

import (
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"iter"
	"maps"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/sandstorm/dashica/lib/clickhouse"
	"github.com/sandstorm/dashica/lib/dashboard/filter"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
	"github.com/sandstorm/dashica/lib/httpserver"
	"github.com/sandstorm/dashica/lib/util/handler_collector"
)

// WidgetDefinition is a widget of a page: what it has beyond its props it implements as withQuery, withHandler and
// withChildren, and Mount describes it for page.json by the type it is registered as (Register).
type WidgetDefinition interface{}

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
			node.Connection = sql.ConnectionOf(chart.Query())
			for _, field := range filterableFields(ctx.Deps, chart) {
				node.Filterable = append(node.Filterable, field.Alias())
			}
			for _, field := range computedFields(ctx.Deps, chart) {
				node.Computed = append(node.Computed, field.Alias())
			}
			if table, ok := ctx.Deps.FilterService.TableOf(chart.Query()); ok {
				node.Table = ctx.Deps.FilterService.TableName(table)
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

// Node describes a mounted widget in page.json: its type, its props (its fields tagged `dashica-gen:"client"` and what
// its computeProps computes), the URL of its handler, and its children.
type Node struct {
	Type  string          `json:"type"`
	Props json.RawMessage `json:"props"`
	// DataURL is where its handler answers ("/p/shop/api/3": /query, /debug, /rows and /sql below it); empty for a
	// widget without data.
	DataURL string `json:"dataUrl,omitempty"`
	// RowsURL is where the Explore view's rows of it answer ("/p/shop/api/3/rows": its result, `?exploreSql=` an edited
	// query); empty for a widget without a query.
	RowsURL string `json:"rowsUrl,omitempty"`
	// Filterable are the aliases of its fields a click may filter by, each a pill on its table (`<dataUrl>/pill`): its
	// fields that hold categories (sql.IsCategory, no constant), when its query has a table (sql.From, sql.Table) and
	// does not skip filters; empty for every other widget.
	Filterable []string `json:"filterable,omitempty"`
	// Computed are those of Filterable that are more than a column of Table (an expression, a FilterAs, a renamed
	// column, any field of a SQL file: sql.ColumnOf): "add filter" lists them as computed fields, the others among the
	// table's columns.
	Computed []string `json:"computed,omitempty"`
	// Table is the table its pills are on as their keys name it (filter.FilterService.TableName: "http_logs" on a
	// connection to `default`, "monitoring.full_logs" else), when its query has one and takes filters: the filter bar's
	// "add filter" offers the page's columns and fields by table (`<dataUrl>/fields`, their values `<dataUrl>/values`),
	// and finds the chart that edits a pill by it.
	Table string `json:"table,omitempty"`
	// Connection is the ClickHouse connection its query runs on (sql.ConnectionOf: "default", "logs"); empty for a
	// widget without a query. The Schema view shows a page's connections first.
	Connection string `json:"connection,omitempty"`
	// Children by name: a grid's areas; a collapsible group's widgets as "0", "1", ….
	Children map[string]Node `json:"children,omitempty"`
	// Title is its title for the page's outline (Outline); in page.json it is in its props.
	Title string `json:"-"`
}

// Widgets is an ordered list of child widgets, e.g. inside a CollapsibleGroup.
type Widgets []WidgetDefinition

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

// WidgetsMap maps an area/slot name to its widget, e.g. Grid's named areas.
type WidgetsMap map[string]WidgetDefinition

// Outline is the charts among `nodes` and their children, in the order they were mounted: the widgets with data and a
// title, each with the title of the collapsible group around it.
func Outline(nodes []Node) []rendering.OutlineEntry {
	return outline(nodes, "")
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

// withProps is a widget's props in page.json, its fields tagged `dashica-gen:"client"` and what its computeProps
// computes when the page is mounted (a markdown's HTML): dashica-gen generates marshalProps for every registered widget.
type withProps interface {
	marshalProps(ctx *rendering.DashboardContext) ([]byte, error)
}

// withQuery is a chart: Mount serves the query it runs (queryHandler).
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

// outline is Outline inside the collapsible group titled `group` ("" outside one).
func outline(nodes []Node, group string) []rendering.OutlineEntry {
	entries := []rendering.OutlineEntry{}
	for _, node := range nodes {
		if node.DataURL != "" && node.Title != "" {
			entries = append(entries, rendering.OutlineEntry{DataUrl: node.DataURL, RowsUrl: node.RowsURL, Title: node.Title, Group: group})
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

// queryHandler serves the query of `chart`: /query (the data, Arrow), /debug (the query, EXPLAIN), /rows (the Explore
// view's rows in plain Arrow types, HandleRows: the chart's result; with `?exploreSql=<text>` the query the viewer
// edited, its `param_<name>` values bound, HandleEditedRows, at most httpserver.ExploreRowLimit rows) and /sql (the
// chart's query with its parameters, HandleSql), each with the pills of the request on its table (filter.Apply; a pill
// not signed with app_secret is a 400, as is a query state that cannot be read, or a SQL chip while sql_filter_enabled
// is off); and /pill, the pill of one of its fields (pillHandler); /values, the values of one of them (valuesHandler);
// /fields, its table's columns and its computed fields with their types (fieldsHandler). /sql and `exploreSql` answer
// 404 unless explore_enabled (their handlers check deps.Config).
func queryHandler(deps rendering.Dependencies, chart withQuery) http.Handler {
	qh := httpserver.QueryHandler{
		ClickhouseClientManager: deps.ClickhouseClientManager,
		Logger:                  deps.Logger,
		FileSystem:              deps.FileSystem,
		Config:                  deps.Config,
	}
	query := chart.Query()
	serve := func(handle func(sql.SqlQueryable, httpserver.QueryState, filter.Diagnostics, http.ResponseWriter, *http.Request) error) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			state, err := httpserver.ParseQueryState(r)
			if err != nil {
				httpError(w, err)
				return
			}
			pills, err := openPills(deps, state.Pills)
			if err != nil {
				httpError(w, err)
				return
			}
			table, ok := deps.FilterService.TableOf(query)
			filtered, diagnostics := filter.Apply(query, table, ok, pills)
			httpError(w, handle(filtered, state, diagnostics, w, r))
		}
	}
	rows := serve(qh.HandleRows)
	mux := http.NewServeMux()
	mux.Handle("/query", serve(qh.HandleQuery))
	mux.Handle("/debug", serve(qh.HandleDebug))
	mux.HandleFunc("/rows", func(w http.ResponseWriter, r *http.Request) {
		if args := r.URL.Query(); args.Has("exploreSql") {
			httpError(w, qh.HandleEditedRows(query, args.Get("exploreSql"), httpserver.EditedParameters(args), httpserver.ExploreRowLimit, w, r))
			return
		}
		rows(w, r)
	})
	mux.Handle("/sql", serve(qh.HandleSql))
	mux.Handle("/pill", pillHandler(deps, chart))
	mux.Handle("/fields", fieldsHandler(deps, qh, chart))
	mux.Handle("/values", valuesHandler(deps, qh, chart))
	return mux
}

// openPills are the pills of `keys` (filter.FilterService.Open, a table without database in its connection's from
// dashica_config); a QueryStateError (400) for the first one not signed with app_secret.
func openPills(deps rendering.Dependencies, keys []string) ([]filter.Pill, error) {
	pills := make([]filter.Pill, 0, len(keys))
	for _, key := range keys {
		pill, err := deps.FilterService.Open(key)
		if err != nil {
			return nil, &httpserver.QueryStateError{Reason: err.Error()}
		}
		pills = append(pills, pill)
	}
	return pills, nil
}

// httpError answers `err`: 400 for a query state that cannot be read, 404 for an Explore endpoint while Explore is
// off, 422 for a field or column that cannot filter, else 500; nothing for nil.
func httpError(w http.ResponseWriter, err error) {
	if err == nil {
		return
	}
	status := http.StatusInternalServerError
	var bad *httpserver.QueryStateError
	if errors.As(err, &bad) {
		status = http.StatusBadRequest
	}
	if errors.Is(err, httpserver.ErrExploreNotEnabled) {
		status = http.StatusNotFound
	}
	if errors.Is(err, filter.ErrCannotFilter) {
		status = http.StatusUnprocessableEntity
	}
	http.Error(w, err.Error(), status)
}

// pillHandler answers `GET /pill?field=<alias>&value=<shown value>&op=eq|ne|lt|le|gt|ge` with the pill (filter.New) of
// the chart's filterable field `field` on its table, as JSON `{key, label}`: its key signed with app_secret
// (filter.FilterService.Sign), its label the chip's text. With `column=<name>` in place of `field` the pill on that
// column of its table (filterBy: checked against the schema); a field that is just a column (columnOf) makes that
// column's pill too, so its key is as short as one from "Add filter". 422 for a field that cannot filter
// (filterableFields) or a column its table does not have, 400 for a request without `value` or with another op.
func pillHandler(deps rendering.Dependencies, chart withQuery) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		args := r.URL.Query()
		op := sql.Op(args.Get("op"))
		if !args.Has("value") || !op.Valid() {
			http.Error(w, "want ?field=<alias>&value=<value>&op=eq|ne|lt|le|gt|ge", http.StatusBadRequest)
			return
		}
		table, target, err := filterBy(r, deps, chart)
		if err != nil {
			httpError(w, err)
			return
		}
		field := target.field
		if name, plain := columnOf(chart, field); plain && !target.column {
			field = sql.ColumnField(name)
		}
		pill, err := filter.New(table, field, op, args.Get("value"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusUnprocessableEntity)
			return
		}
		key, err := deps.FilterService.Sign(pill)
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

// filterBy is what a request to /pill or /values filters `chart` by, on its table: with `?field=<alias>` one of its
// filterableFields, over its query; with `?column=<name>` the column `name` of its table as the connection's schema has
// it (tableColumns; the name is checked there, never taken from the client as SQL), its name quoted (sql.ColumnField),
// over its query when that is a builder query (its From and Where) or else the table itself (a SQL file's result need
// not have the column). An error wrapping filter.ErrCannotFilter (422) for a field or column it cannot filter by.
func filterBy(r *http.Request, deps rendering.Dependencies, chart withQuery) (filter.Table, filterTarget, error) {
	args := r.URL.Query()
	table, ok := deps.FilterService.TableOf(chart.Query())
	if !args.Has("column") {
		alias := args.Get("field")
		fields := filterableFields(deps, chart)
		i := slices.IndexFunc(fields, func(f sql.SqlField) bool { return f.Alias() == alias })
		if i < 0 || !ok {
			return filter.Table{}, filterTarget{}, fmt.Errorf("%q: %w this chart's table", alias, filter.ErrCannotFilter)
		}
		return table, filterTarget{field: fields[i], query: chart.Query()}, nil
	}
	name := args.Get("column")
	if !ok {
		return filter.Table{}, filterTarget{}, fmt.Errorf("column %q: %w a chart without a table", name, filter.ErrCannotFilter)
	}
	columns, err := tableColumns(r.Context(), deps, table)
	if err != nil {
		return filter.Table{}, filterTarget{}, err
	}
	i := slices.IndexFunc(columns, func(c clickhouse.SchemaColumn) bool { return c.Name == name })
	if i < 0 {
		return filter.Table{}, filterTarget{}, fmt.Errorf("column %q is not in %s: %w", name, table.Name, filter.ErrCannotFilter)
	}
	query := chart.Query()
	if _, builder := query.(*sql.SqlQuery); !builder {
		query = sql.New(sql.From(table.Name), sql.OnDatabase(table.Connection))
	}
	return table, filterTarget{field: sql.ColumnField(name), column: true, query: query}, nil
}

// filterTarget is what a request filters a chart by (filterBy).
type filterTarget struct {
	field sql.SqlField
	// column is set for a column of the chart's table.
	column bool
	// query is the query whose rows have the field: the values of /values are asked over it.
	query sql.SqlQueryable
}

// filterableFields are the fields of `chart` a pill filters by: its dimensions that hold categories, each alias once,
// without a SQL file's or string's columns it selects as a constant (`'darkred' AS color`, sql.IsConstantColumn, its
// text read with deps.FileSystem; a file that cannot be read has none); none when its query has no table or skips
// filters.
func filterableFields(deps rendering.Dependencies, chart withQuery) []sql.SqlField {
	d, ok := chart.(withDimensions)
	query := chart.Query()
	if _, hasTable := sql.TableOf(query); !ok || !hasTable || query.ShouldSkipFilters() {
		return nil
	}
	text := ""
	if _, builder := query.(*sql.SqlQuery); !builder {
		text, _ = sql.BuildWithFS(query, deps.FileSystem)
	}
	var fields []sql.SqlField
	for _, field := range d.dimensions() {
		if field == nil || !sql.IsCategory(field) || slices.ContainsFunc(fields, func(f sql.SqlField) bool { return f.Alias() == field.Alias() }) {
			continue
		}
		if text != "" && sql.IsConstantColumn(text, field.Definition()) {
			continue
		}
		fields = append(fields, field)
	}
	return fields
}

// tableColumns are the columns of `table` in the schema of its connection (clickhouse.Client.Schema, asked once and
// then kept), a name without database in `default`; an error wrapping filter.ErrCannotFilter for a table the schema
// does not have.
func tableColumns(ctx context.Context, deps rendering.Dependencies, table filter.Table) ([]clickhouse.SchemaColumn, error) {
	client, err := deps.ClickhouseClientManager.GetClient(table.Connection)
	if err != nil {
		return nil, err
	}
	schema, err := client.Schema(ctx, false)
	if err != nil {
		return nil, err
	}
	database, name, ok := strings.Cut(table.Name, ".")
	if !ok {
		database, name = "default", table.Name
	}
	columns, ok := schema.Columns(database, name)
	if !ok {
		return nil, fmt.Errorf("%s is not in the schema of %q: %w", table.Name, table.Connection, filter.ErrCannotFilter)
	}
	return columns, nil
}

// columnOf is the column of its table `field` of `chart` is (sql.ColumnOf), for a builder query only: a SQL file's
// field is a column of its result.
func columnOf(chart withQuery, field sql.SqlField) (string, bool) {
	if _, builder := chart.Query().(*sql.SqlQuery); !builder {
		return "", false
	}
	return sql.ColumnOf(field)
}

// fieldsHandler answers `GET /fields` with the fields "add filter" offers of the chart, as JSON `{columns: [{name,
// type}], computed: [{name, type}]}` (HandleFields): the columns of its table (tableColumns), each a pill through
// /pill's `column`, and its computedFields with their types. It answers without explore_enabled: it serves only the
// chart's own table and fields. 422 for a chart without a table, 400 for a query state that cannot be read.
func fieldsHandler(deps rendering.Dependencies, qh httpserver.QueryHandler, chart withQuery) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		table, ok := deps.FilterService.TableOf(chart.Query())
		if !ok {
			httpError(w, fmt.Errorf("this chart has no table: %w", filter.ErrCannotFilter))
			return
		}
		state, err := httpserver.ParseQueryState(r)
		if err == nil {
			// a time range that cannot be resolved is refused before the schema is asked
			_, err = state.ResolveTimeRange(time.Now())
		}
		if err != nil {
			httpError(w, err)
			return
		}
		columns, err := tableColumns(r.Context(), deps, table)
		if err != nil {
			httpError(w, err)
			return
		}
		httpError(w, qh.HandleFields(columns, chart.Query(), computedFields(deps, chart), state, w, r))
	}
}

// computedFields are those of the filterableFields of `chart` that are more than a column of its table (columnOf):
// an expression, a FilterAs, a renamed column, any field of a SQL file.
func computedFields(deps rendering.Dependencies, chart withQuery) []sql.SqlField {
	return slices.DeleteFunc(filterableFields(deps, chart), func(field sql.SqlField) bool {
		_, plain := columnOf(chart, field)
		return plain
	})
}

// valuesHandler answers `GET /values?field=<alias>&search=<text>` (or `column=<name>` for a column of its table,
// filterBy) with the values of the chart's filterable field `field` that contain `search` (ignoring case), at most
// httpserver.ValuesLimit, sorted, as JSON `{values}` (HandleValues): sql.Values of its query in the request's time
// range, SQL chips and pills, the pills on that field left out, so that a value besides one filtered by is still
// offered. 422 for a field that cannot filter (as /pill), 400 for a pill not signed with app_secret or a query
// state that cannot be read.
func valuesHandler(deps rendering.Dependencies, qh httpserver.QueryHandler, chart withQuery) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		table, target, err := filterBy(r, deps, chart)
		if err != nil {
			httpError(w, err)
			return
		}
		state, err := httpserver.ParseQueryState(r)
		if err != nil {
			httpError(w, err)
			return
		}
		pills, err := openPills(deps, state.Pills)
		if err != nil {
			httpError(w, err)
			return
		}
		_, plain := columnOf(chart, target.field)
		filtered, _ := filter.Apply(target.query, table, true, othersThan(pills, table, target.field.Alias(), target.column || plain))
		httpError(w, qh.HandleValues(sql.Values(filtered, target.field, httpserver.ValuesLimit), state, r.URL.Query().Get("search"), w, r))
	}
}

// othersThan are `pills` without those on `field` of `table`: the pills on its column with `column` (a column, or a
// field that is just one, makes the column's pill, pillHandler), else those on the computed field of that alias.
func othersThan(pills []filter.Pill, table filter.Table, field string, column bool) []filter.Pill {
	return slices.DeleteFunc(slices.Clone(pills), func(p filter.Pill) bool { return p.Table == table && p.Field == field && p.Column == column })
}
