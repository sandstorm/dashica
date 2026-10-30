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
// Arrow) and "/debug" (the query, EXPLAIN).
type withQuery interface {
	Query() sql.SqlQueryable
}

// withDimensions is a chart's own fields, which filter.Apply interprets a filter id as (by alias): the slots tagged
// `dashica-gen:"role=dimension"` that are set (generated), a table's GROUP BY or select fields.
type withDimensions interface {
	dimensions() []sql.SqlField
}

// withFilters is a chart that interprets the request's filters itself: `q` (its Query) with those it interprets
// added, and what it did. Every other chart gets filter.Apply.
type withFilters interface {
	ApplyFilters(q sql.SqlQueryable, filters []filter.Filter) (sql.SqlQueryable, filter.Diagnostics)
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
	// DataURL is where its handler answers ("/p/shop/api/3": /query and /debug below it); empty for a widget
	// without data.
	DataURL string `json:"dataUrl,omitempty"`
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

// DataHandler answers the requests below a widget's URL: a withQuery's query (queryHandler, its base table's columns
// from ClickHouse), a withHandler's Handler; nil for a widget without data.
func DataHandler(deps rendering.Dependencies, w WidgetDefinition) http.Handler {
	if chart, ok := w.(withQuery); ok {
		return queryHandler(deps, chart, deps.ClickhouseClientManager.Columns)
	}
	if data, ok := w.(withHandler); ok {
		return data.Handler(deps)
	}
	return nil
}

// queryHandler serves the query of `chart`: /query (the data, Arrow) and /debug (the query, EXPLAIN), each with the
// request's filters as the chart interprets them (applyFilters, base-table columns from `columns`); a request whose
// query state cannot be read is a 400.
func queryHandler(deps rendering.Dependencies, chart withQuery, columns filter.Columns) http.Handler {
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
			filtered, diagnostics, err := applyFilters(r.Context(), chart, query, state.Filters, columns)
			if err != nil {
				httpError(w, err)
				return
			}
			httpError(w, handle(filtered, state, diagnostics, w, r))
		}
	}
	mux := http.NewServeMux()
	mux.Handle("/query", serve(qh.HandleQuery))
	mux.Handle("/debug", serve(qh.HandleDebug))
	return mux
}

// applyFilters is `query` of `chart` with the filters it interprets, and what it did: its own ApplyFilters, else
// filter.Apply on its dimensions.
func applyFilters(ctx context.Context, chart withQuery, query sql.SqlQueryable, filters []filter.Filter, columns filter.Columns) (sql.SqlQueryable, filter.Diagnostics, error) {
	if own, ok := chart.(withFilters); ok {
		filtered, diagnostics := own.ApplyFilters(query, filters)
		return filtered, diagnostics, nil
	}
	var fields []sql.SqlField
	if d, ok := chart.(withDimensions); ok {
		fields = d.dimensions()
	}
	return filter.Apply(ctx, query, fields, filters, columns)
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
