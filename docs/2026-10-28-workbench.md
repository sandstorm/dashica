# Workbench — application shell and extensions (technical concept)

Status: concept agreed 2026-10-28; steps 1–5b done (2026-10-30), next step 6. Branch `feature/workbench` in `dashica-src`; merges to
`main` as a whole at the end (§5).

## 1. Context and goal

Dashica should feel like an *application* with Grafana-level polish, not a mixture of "document" and "application".
Today:

- Filtering from charts is clunky: filters are a raw SQL string; active filters are not visible as such.
- No keyboard / commands: no palette, no shortcuts for time presets, refresh, jumping to dashboards.
- Unclear feedback: which charts load, which failed, how long queries take.
- Mixed paradigm: server-rendered pages + Alpine sprinkles + dockview geometry + a 1,600-line Explore class.

**Goal:** take over the UI paradigm of VS Code as done in Zwiebelfisch (`../typst-experiment`, its
`docs/40_architecture/`): a **workbench** with fixed regions, **commands**, **menus** and **extensions** that fill the
regions through contribution points. Dashboards keep being declared in Go only.

**Guiding principle: as little complexity as possible, but it behaves nicely.**

## 2. Current state

| Area | Today | Where |
|---|---|---|
| Page rendering | templ renders chrome and widget containers; widgets carry their props as JSON attributes (`data-chart-props`); charts are drawn client-side with Observable Plot | `lib/components/**` (675 lines templ), `frontend/chart/*` |
| Client state | Alpine stores; `store.ts` syncs the URL: global time state (`time`, `range`, `refresh`, `log`; default `24h` hard-coded) and a per-scope `FilterScope` (`sql`, `wp`) | `frontend/store.ts` |
| Layout | dockview, wrapped by an adapter; Explore uses its own 3-pane layout | `frontend/components/dock.ts`, `frontend/explore/editor.ts` (1,616 lines) |
| Routing | each dashboard mounts its handlers recursively (`CollectHandlers`, `handlerCollector.Nested(url)`); widget ids from a render-order counter (`NextWidgetId`) | `lib/util/handler_collector`, `lib/dashboard/widget/*` |
| Filters | the client sends `filters` JSON (`DashboardFilters`: time range + free SQL); `SqlClause()` builds one WHERE fragment (assumes a `timestamp` column) and puts it into `{{DASHICA_FILTERS}}` / `Where(...)`; `FromFileWithoutFilters` opts out. The older path via ClickHouse's `additional_table_filters` is deprecated | `lib/httpserver/query_new.go`, `lib/dashboard/sql/from_file.go` |
| Widget params | `CheckboxGroup` / `TextInput` write `widgetParams` (`?wp=`); the server passes them as ClickHouse parameters (`param_<name>`) for `{name:String}` in SQL | `lib/dashboard/widget/{checkbox_group,text_input}.go`, `lib/clickhouse/query.go` |
| Filter buttons | `.FilterButton(...)` with a raw SQL string | `lib/dashboard/dashboard.go` |
| Alerts on dashboards | alert widgets send the same `filters` JSON, but the handler only uses it to resolve the time range (`X-Dashica-Resolved-Time-Range`); the alert query itself ignores filters. Alert evaluation (`lib/alerting`) runs independently | `lib/httpserver/query_alerts.go` |
| Code generation | `dashica-gen` discovers widgets, fields, enums, roles and emits the Go serializers | `cmd/dashica-gen`, `zz_generated.dashica.go` |
| Explore | round-trips widget JSON to the server for HTML (`/api/preview/render`), then reads attributes back; inline POST for data | `lib/explore`, `frontend/explore/*` |

Of the 675 lines of templ, the widget templates (~140) only emit containers with JSON attributes, a CSS grid string
and a wrapper around goldmark HTML; the rest (~440) is chrome the workbench replaces anyway. The real server work (SQL,
filters, buckets, Arrow data handlers, markdown, alerts, schema) is not templ.

## 3. Proposed solution

### 3.1 Server and client: Go declares, the client renders

Dashboards, filters and actions are declared only in Go (the fluent builder, as Filament does it in PHP); nothing
dashboard-specific is written in TS. The client is a generic renderer. Charts are client-rendered already; moving the
rest gives compiled and Explore dashboards **one** render path.

### 3.2 Routing: recursive, no central API

Everything of a page lives under its own URL, mounted by its own `CollectHandlers`. API calls stay local to the
dashboard; access control can later be a middleware on a page's subtree. **Entry-point URLs (`/p/<page>`) stay as
they are**; inner API URLs may change.

```
GET  /workbench.json               menu groups, each page with its outline (below; the Explore URL with its rebuild); fetched once on boot (the one global endpoint)
GET  /p/shop                       shell HTML (the same for every page)
GET  /p/shop/page.json             {kind, title, defaultTime, filterBar, filterButtons, widgets}; actions with step 7+
GET  /p/shop/api/<id>/query        widget data (Arrow), what the chart did in X-Dashica-Diagnostics (§3.8)
GET  /p/shop/api/<id>/debug        query, EXPLAIN
POST /p/shop/action/<id>           a Go action (§3.9)                                                        ← new
```

- `page.json` is built **in the same `CollectHandlers` pass** that mounts the widget handlers, so it carries exactly
  the mounted URLs. A compiled dashboard never changes: its JSON is built once at registration.
- **Navigation without reloads:** the shell boots once; a link fetches the target's `page.json` and swaps the content
  (`history.pushState`). Panel state survives navigation; the time range does not (§3.7).
- **Data per widget:** each chart fetches from its own handler URL, in parallel, as today. Explore (later) keeps an
  inline POST. Both sit behind `ctx.query()` (§3.6).
- **The outline: what a page holds by title** (decided 2026-10-30). Registering a page produces its description as a
  value: `CollectHandlers` returns the `PageJson` it mounted. Its **outline** is a pure function of that value,
  `widget.Outline(page.Widgets)`: every widget with data and a title, `{id, title, group}` (the id in its `dataUrl`,
  `group` the title of the collapsible group around it), in the order the page mounted them. The title comes typed
  from the widget: `dashica-gen` generates `widgetTitle()` from each widget's client field `title` (as it generates
  `marshalProps`), and `Mount` puts it on the Node as `Title` (Go only, `json:"-"`), so `page.json` stays as it is.
  Each menu entry of `/workbench.json` carries its page's outline (`{title, url, outline}`); the browser searches it
  and builds `#w=` links from it. Filtering `/workbench.json` per user (permissions, §6) covers the menu and the
  outlines alike.
- **Markdown** stays rendered by goldmark on the server, once when the page is mounted: its HTML is in its props
  (`html`, from its `computeProps`: a struct of what the server computes, beside the widget's definition, §3.3). The schema table's handler serves its
  `SHOW CREATE TABLE` (`<dataUrl>/schema`), as it asks ClickHouse.

### 3.3 Type-safe contract: `dashica-gen` emits TS too

Go is the source of truth. `dashica-gen` additionally emits TS types: a discriminated union `Widget = {type:
'timeBar', props: TimeBarProps} | …` plus the DTOs (`page.json`, `workbench.json`, actions). Go tests write golden
JSON fixtures, TS tests read them, so drift fails a test on both sides.

A widget's props are its fields tagged `dashica-gen:"client"`, plus what the server computes when the page is
mounted: a widget with a method `computeProps(ctx *rendering.DashboardContext) (<struct>, error)` gets that
struct's fields too, in its props and its TS props. They stay out of its definition, so out of what Explore stores,
the editor and gocode:

```go
// markdownComputed is what the server computes for a markdown when the page is mounted.
type markdownComputed struct {
	// html is content or file rendered to HTML.
	html string
}
```

An enum is a type annotated `//dashicagen:enum`, of the form `struct{ v string }` with its values as package-level
vars (`var OrderSum = StackOrder{"sum"}`), so a value outside them does not compile. `dashica-gen -enums` writes its
`String`, `GoString` (the Go code Explore writes), `MarshalJSON` and an `UnmarshalJSON` that refuses an unknown value,
from the syntax only, so also for a package that needs them to compile;
the TS types have its values as a union, in the widgets' props and in the DTOs.

### 3.4 Workbench regions

```
┌─ Dashica › Shop ────── [⌘K search] ── [Last 1h ▾][⟳ 30s][log] ┐   title bar
│▐menu▌ filters: [Status = 500 ×] [Only errors] ✎ SQL │▐inspector▌│   filter bar (above the content)
│▐    ▌ content (scrolls)                          │▐         ▌│   left · content · right
│▐    ▌ bottom panel: Debug │ Details              │▐         ▌│   bottom panel (below the content)
└─ status: 12 queries · 2 loading · 1 failed · 340 ms ──────────┘   status bar
```

| Region | Holds |
|---|---|
| Title bar | breadcrumb, search everywhere, time range, refresh; always visible |
| Filter bar | above the content, between the side panels, only while it has something to show: active filters as removable chips, the page's filter buttons as toggles, the SQL filter (opened from the funnel button in the title bar) |
| Left side panel | "Dashboards" (menu groups, favorites, search); later Explore's widget tree |
| Right side panel | later Explore's inspector |
| Bottom panel | Debug (query, EXPLAIN); later row details |
| Status bar | query count, loading, failures, timings |

- The layout is ported from Zwiebelfisch (`WindowLayout`, `SideBar`: one CSS grid, rails with a button per panel,
  resizable, state remembered, left panel overlays on narrow screens) plus a bottom panel.
- **One page at a time**, no tabs inside the app; browser tabs do that.
- A **page** is what the content area shows: `page.kind` = `dashboard` | `explore` | `docs`.

### 3.5 Extensions and UI code

As in Zwiebelfisch: an extension is `{ id, contributes, activate(context) }`; it registers into the hosts' contribution
points, pushes every registration (a `Disposable`) into `context.subscriptions`, and never imports another extension.
Hosts keep only mechanism.

What several extensions need for drawing lives in a library folder `frontend/extensions/<name>-library/`: stateless
helpers, no `Extension`, no state of its own at module level (what it builds may keep the state of the drawn element,
a table's search box). Extensions may import a `-library` folder. `chart-library` holds the column check
(`SchemaAnalyzer`), the time selection of the time charts (`timeBrush`: for now a drag sets the page's time range,
through `DrawOptions.onTimeSelect`, as on the legacy page; step 7 turns it into a selection, §3.8) and the table (`drawTable`: the widget type `table`, the Debug panel).

| Host | Offers |
|---|---|
| `commands` | `registerCommand`, `executeCommand`; keys via `contributes.keybindings` |
| `ui` | side / bottom panels, title bar and status bar items, `registerMenuItem`, `showContextMenu`, quick pick, messages, search providers |
| `widgets` | `registerWidget` (§3.6) |
| `page` | the shown page (`page.json`), `onDidChangePage` |
| `query` | the state every query depends on (§3.7) |
| state | `globalState` / `workspaceState` instead of direct `localStorage` |

- Client extensions live only in `dashica-src`; the instances customize through Go.
- **Extensions do not depend on each other (for now).** What several need goes into a host (e.g. `query.time`).
  When that would turn a feature into a host only to share one model (Explore's tabs on `ExploreModel` are the likely
  case), take VS Code's way: `dependsOn: ['explore']`, and what `activate()` returns is its API to the dependents.
- **Plain DOM, no Alpine, no reactivity library.** Models with private state and `onDidChange` events ("commands out,
  events back"); consumers re-render their region coarsely on change. If derived state across many sources gets
  painful, we add a small observable primitive of our own.
- **Styling:** BEM classes with the prefix `d-` and a fixed set of tokens, without Tailwind and daisyUI (decided 2026-10-30, `docs/2026-10-30-styling.md`).

### 3.6 Widgets

A widget type is a contribution; its renderer is a function. Charts, tables, markdown, form inputs, the grid and
collapsible groups are extensions.

```ts
widgets.registerWidget('timeBar', renderTimeBar);
function renderTimeBar(el, widget: WidgetOf<'timeBar'>, ctx): Disposable   // widget: generated type (§3.3)

ctx.query(): Promise<QueryResult>          // Arrow table; tracks loading / ok / error itself (status bar, Debug)
result.dashicaDiagnostics                  // {ignored: string[], skipped?: string}, from X-Dashica-Diagnostics (§3.8)
ctx.state                                  // the QueryApi: time / filters / params / cursor (§3.7)
ctx.state.onDidRequestRefresh              // time, filter, param or refresh changed
ctx.url(path)                              // below the widget's handler, with the query state (Speedscope)
ctx.renderChild(el, child)                 // grid, collapsible
ctx.showMenu(anchor)                       // the menu `widget/context` (Debug, …)
ctx.addFilter(fieldId, op, value)          // click-to-filter (§3.8); fieldId: the clicked column's alias
ctx.select({kind, fieldId, value, anchor}) // the page's one selection (§3.8, step 6.7); ctx.clearSelection()
```

- Function, not class: Plot draws a fresh SVG anyway; a prop change disposes and renders again.
- **Each widget composes itself; the host does not wrap.** Mandatory mechanism sits in `ctx` (`ctx.query()` tracks
  status, so the status bar and Debug work for every widget). The visual chart frame (render once visible, observe
  size, spinner, error, the chart's Diagnostics §3.8 as "ignores host" or "skipped: …", menu button) is **one optional
  helper**, `new ChartFrame(el, ctx, { draw })`; charts use it in one line, containers and markdown don't.
- **Form widgets** (`CheckboxGroup`, `TextInput`) are ordinary widget extensions that read and write `query.params`.

### 3.7 Query state and one request format

| Model | Holds | URL | Scope |
|---|---|---|---|
| `time` | time range, auto refresh | `?time=1h` | per page; default declared in Go (`.DefaultTimeRange("168h")`, a Go duration as the presets send it; fallback `24h`); navigation opens the target with its own default (as Grafana) |
| `filters` | structured filters, a time-window filter, free SQL | `?f=…&tw=…&sql=…` | per page |
| `params` | values of form widgets | `?wp=…` | per page |
| `cursor` | hovered timestamp | — (ephemeral) | synchronized crosshair across all time charts |

Every data handler reads the same query parameters; the server parses them once in `lib/httpserver` into one
`QueryState` (time, filters, params). Params stay what they are today: ClickHouse parameters (`param_<name>`); the
client owns the UI, the server only binds.

✅ (step 6.1) **The request carries the page URL's own keys:** `time`, `range`, `sql`, `wp` (no JSON parameters
`filters` / `params`). `requestParams()` sends `time` also when it is the page's default, since the server does not
know the page's default. `httpserver.ParseQueryState(r)` reads them once per request; a missing `time`, a `time` that
is neither a Go duration nor `custom`, or a `wp` that is not a JSON object of strings fails the request with that
reason (chart error, 400 from `/time-range` and the alert widgets). A chart with `FromFileWithoutFilters` /
`SkipFilters()` still needs `time` in its request, but its query ignores it.

✅ (2026-10-30, with the time picker) **The time range is resolved once per request, in Go:**
`QueryState.ResolveTimeRange(time.Now())` gives the window in ms, and every handler passes it to `SqlClause` and
`X-Dashica-Resolved-Time-Range`. Presets use the server's clock (not ClickHouse's `now()`), so the charts of a page
query the same numbers. The legacy `From` / `To` and the ClickHouse query for `now()` are gone. `GET /time-range`
answers the same window for the picker.

✅ **Time range as in Grafana (decided and done 2026-10-30):** the title bar shows one button with the range
("Last 1 hour", "2026-10-29 10:00 to 12:00"), and beside it ‹ › (shift by the window's length) and ⊖ (zoom out to twice the window). The
button opens a panel below it: on the left From / To and "Apply", and the custom ranges used last (3, per viewer); on
the right the quick ranges (the presets), filtered by typing. From and To are each an absolute time
(`2026-10-29 10:00`, in the server's time zone, as before) or a time relative to now (`now`, `now-6h`; units `s m h d w`). The
**server** understands these expressions, as Grafana does, so a relative range moves with auto refresh and a shared
link stays relative: `?time=custom&range=now-6h to now-1h`. A preset is any Go duration (`?time=90m`). No calendar in
the first version. Apply asks `/time-range` and shows the server's reason when it cannot read a time; shift and zoom
out take their window from it, so the grammar lives in Go only. **Open:** the server reads an absolute time in its
own time zone, while a selection on a chart writes the viewer's local time (as on the old page); for a viewer in
another zone the window is off by the difference.

**A query nobody waits for stops** (decided 2026-10-30). The client half exists: `ChartFrame` aborts its running
request on each refresh and on dispose (navigation), and the Go handlers pass `r.Context()` to the request to
ClickHouse, so that request is cancelled as well. Missing: ClickHouse keeps running a SELECT whose HTTP client went
away unless the query carries `cancel_http_readonly_queries_on_client_close=1`; `lib/clickhouse` sets it on every
query.

**Auto refresh pauses in a hidden tab** (decided 2026-10-30): the `query` host skips a tick while `document.hidden`,
and refreshes once when the tab is shown again if it skipped one; the next tick follows a whole interval after that
refresh.

✅ (step 6.1) **Alerts:** alert widgets only need the time range, so they read `time` / `range` like every other
handler and never `sql`: an alert chart's `{{DASHICA_FILTERS}}` is the window alone (`httpserver.TimeClause`).
Dashboard filters do not apply to alert widgets, and alert evaluation (`lib/alerting`) is not touched.

### 3.8 Filters: structured, interpreted by the chart, explicit

**A filter is an id, an op and a value; the chart that runs decides what it means** (decided 2026-10-30). The page
registers nothing: no list of filter fields, no lookup in a shared object, no check across charts. A chart's handler
gets the request's filters as plain values (`[{id, op, value}]` from `httpserver.QueryState`), builds its query from
them and returns what it did as **Diagnostics**, sent with its data. Everything happens in Go, per request; the client
only shows and sends ids.

- **The id is the alias of the clicked column** (`host`, `status`): the browser sends the alias the chart's data
  carries, and a chip's label is its id. `page.json` carries no filter fields and a chart's Node no filter ids.
- **Ops:** `eq` (Filter by …) and `ne` (Exclude …); a NULL is not selectable. More (`in`, ranges) when a UI needs
  them.

The URL carries ids, ops and values (`?f=status:eq:500&f=host:ne:a`; the value is everything after the second colon);
**values are bound as ClickHouse parameters** (`{__f0:String}`, beside `__from` / `__to`), never quoted into SQL. The
expression a value is compared with comes only from Go: a chart's own field definitions or a real column of its base
table. No per-backend quoting code, no injection through filters, and no client SQL except the free SQL chip
(`?sql=…`). Filter buttons stay SQL, written in Go, shown as toggles in the filter bar.

✅ Checked 2026-10-30 on ClickHouse 25.9 (`clickhouse local`): a `String` parameter compared with `UInt16`,
`Nullable(UInt16)`, `Float64`, `DateTime` and `LowCardinality(String)` columns converts and matches (`=`, `!=`, also
`IN {p:Array(String)}`); a value that does not convert (`abc` against `UInt16`) fails the query with `TYPE_MISMATCH`
(code 53), which the chart shows as its error. So filters carry no type.

**A chart interprets the filters itself, optionally.** A chart may implement

```go
ApplyFilters(q sql.SqlQueryable, filters []filter.Filter) (sql.SqlQueryable, filter.Diagnostics)
```

and returns its query with the filters it interprets added (one more `sql.Where`, which a SQL file receives in
`{{DASHICA_FILTERS}}`) and the Diagnostics of what it did. A chart without it gets the **default helper** (below). A
query with `SkipFilters()` / `FromFileWithoutFilters` interprets none: every id is ignored.

**Diagnostics** is what a chart tells the outside about one answer, a value returned with the query:

- `Ignored []string`: the filter ids it does not interpret, each once, in URL order;
- `Skipped string`: non-empty when the chart did not run, and why;
- more fields later, as charts need to say more.

The handler sends it as one response header, `X-Dashica-Diagnostics: {"ignored":["host"]}` (JSON; no header when it
is empty), beside `X-Dashica-Resolved-Time-Range`. A skipped chart answers without running ClickHouse. `ChartFrame`
shows the Diagnostics: no badge when they are empty, "ignores `host`", "skipped: …" in place of the chart. The chart
still renders without the filters it ignores. A runtime `UNKNOWN_IDENTIFIER` (ClickHouse code 47, e.g. from the free
SQL chip) fails that chart only, with the column named. No query parsing.

**The default helper** (`lib/dashboard/filter`, a small pure package) interprets a filter id when it is, in this order:

1. **one of the chart's own fields, by alias:** the field's definition (`status`, `JSONExtractString(attrs,'host')`);
2. **a column of the chart's base table** (builder queries, `From` and database): the column itself;

else the id goes into `Ignored`. A **SQL-file chart** (`sql.FromFile`, also `sql.FromString`) interprets only its own
output columns, by name: ClickHouse resolves SELECT aliases in WHERE, and `{{DASHICA_FILTERS}}` sits in the WHERE of
the SELECT that defines them, so `host = {__f0:String}` works for that chart. The author maps nothing and declares no
base table. **Measures** (`count()` etc.) and **time buckets** (an `AutoBucket`, a chart's time axis) are not
interpreted as filters, known from the field's `kind` and slot (time selection is step 7).

**The base table's columns come from `DESCRIBE TABLE`**, asked at a chart's first query and cached per table and
ClickHouse server until restart. The helper takes the column source as a function value, so its tests give it a
fixed list and need no ClickHouse:

```go
// Columns are the names of the columns of `table` on the ClickHouse server `server` ("" for "default") that a filter
// value compares with, as DESCRIBE TABLE gives them.
type Columns func(ctx context.Context, server, table string) ([]string, error)

// fields: the chart's own fields (its dimensions())
func Apply(ctx context.Context, q sql.SqlQueryable, fields []sql.SqlField, filters []Filter, columns Columns) (sql.SqlQueryable, Diagnostics, error)
```

A `DESCRIBE` that fails fails the chart (500) and is not cached.

✅ **Done in 6.3 / 6.4, with these deviations from the sketch above (2026-10-30):**

- **`Filter` lives in `lib/dashboard/filter`**, not in `httpserver`; `QueryState.Filters` is `[]filter.Filter`. So
  `httpserver` writes `X-Dashica-Diagnostics` and answers a skipped chart, importing `filter`; `filter` imports only
  `sql` (with `httpserver.Filter`, `filter` would import `httpserver` and `httpserver` could not name `Diagnostics`).
- **`Columns` has no `database`:** the server alias (`OnDatabase`) names the connection, whose database is in its
  config, and a qualified `From` (`monitoring.full_logs`) carries its own. `clickhouse.Client.Columns(ctx, table)` keeps
  them per table on the server's client (as `IntrospectSchema` does); `Manager.Columns` is the `filter.Columns` the
  charts get. `DESCRIBE TABLE` is asked only when a filter is not one of the chart's own fields.
- **`Apply` takes the chart's own fields** (`fields`): a SQL file's `With` drops `Select`, so its query does not know
  the chart's fields. They are the chart's `dimensions()` (generated from the slots tagged `role=dimension` that are
  set; a table's GROUP BY fields as it selects them, all its select fields without GROUP BY), not every select of the
  query, so a measure aliased as a column (`sum(bytes) AS bytes`) never lands in WHERE.
- **Only columns a filter value compares with:** `Client.Columns` keeps the columns of a type `ClassifyColumnType`
  knows (numbers, strings, enums, dates, UUID, IP, Bool), so a filter on a Map, Array, Tuple or JSON column is
  ignored. Checked 2026-10-30 on ClickHouse 25.9 (`clickhouse local`): a `String` parameter converts to such a column
  only when it is written as ClickHouse SQL (`{'a':'b'}`, `['x']`); what a click gives (`[object Object]`) fails the
  query (`CANNOT_PARSE_INPUT_ASSERTION_FAILED`, `CANNOT_PARSE_QUOTED_STRING`, `INCORRECT_DATA`).
- **One `DESCRIBE` per table:** the first requests for a table share one (`singleflight`); `columns_test.go` checks
  that, the cache, and a failed one asked again, with a stub in place of ClickHouse.
- **A column a select aliases with another expression is ignored** (`sum(bytes) AS bytes`, `toStartOfHour(ts) AS
  ts`): ClickHouse resolves the alias in WHERE, so the column would compare the select. Checked on 25.9: the
  aggregate fails the query (`ILLEGAL_AGGREGATION`), the bucket matches other rows.
- **Explore's preview drops `f`:** its widget, fields and From come from the request; without filters it asks no
  `DESCRIBE`, so the cache holds the tables of mounted dashboards.
- **`timeHeatmap`'s `y` is one of its own fields on the server:** its query groups by y's raw value (the client
  buckets it into rows), so a filter by y's alias compares that raw value, as a base-table column would, and also
  works for an expression (`JSONExtract(attrs, 'duration', 'UInt64') AS duration`). Only its click selection is off.
- **Where it runs:** `widget.queryHandler(deps, chart, columns)` parses the `QueryState` (400 on a `QueryStateError`),
  calls the chart's `ApplyFilters` or `filter.Apply` (500 on its error), then
  `httpserver.QueryHandler.HandleQuery(q, state, diagnostics, w, r)` / `HandleDebug(…)`, which take the parsed state.
  `DataHandler(deps, w)` passes `deps.ClickhouseClientManager.Columns`; the widget tests pass a fixed list.
- `SkipFilters()` / `FromFileWithoutFilters` is `filter.Apply`'s rule; a chart with its own `ApplyFilters` decides
  itself (none has one yet).
- **A skipped chart** answers **204 No Content** with the header; `/debug` answers its `stats` alone. The client reads
  204 as an empty table with its Diagnostics.
- A base-table column that is not a plain identifier is compared in backquotes (`` `my-host` ``); every compared
  expression is in parentheses (`(JSONExtractString(attrs, 'host')) = {__f0:String}`).

**Bound values:** the condition of filter `i` of the request names `{__f<i>:String}` (`ne`: `!=`), so a chart writes
only conditions (`filter.Condition(i, f, expression)` writes one) and the handler binds every filter's value as
`param___f<i>`, also of the filters a chart ignores. **To check:** ClickHouse accepts a bound parameter the query does
not name (the form widgets' `wp` values are bound so for every chart already; the integration test
`TestHandleQuery_AValueOfAnIgnoredFilterIsBoundUnnamed` checks it, run against CI's ClickHouse, not in the sandbox).
Debug's `stats` has `filterClause` (the window and the SQL filter; the structured conditions are in its `query`),
`parameters` (all bound values) and `diagnostics`. Explore's preview serves the same handler and sends no `f`.

`SqlQuery.With` appends a request's `Where` to its own copy of the chart's WHERE list, so concurrent requests cannot
write into the same backing array (from the first 6.4).

✅ (step 6.4) `ParseQueryState` reads each `f` into `QueryState.Filters`; an `f` without id or op, or with an op other
than `eq` / `ne`, is a `QueryStateError`, and a chart's handler answers every `QueryStateError` (also a missing or
unreadable `time`) with 400, other errors with 500. An unreadable custom `range` is `ResolveTimeRange`'s plain error,
so 500 (as before 6.4). The handler calls the chart's `ApplyFilters`, else `filter.Apply`, and writes
`X-Dashica-Diagnostics`.

✅ (step 6.5) **The client keeps, shows and sends them.** A chip's label is its id. `QueryResult.dashicaDiagnostics`
is the header's JSON (`{ignored?, skipped?}`, `{}` without it; a 204 is an empty table); `ChartFrame` shows "ignores
host, path" below the chart, hidden while it ignores none, after a failed query and while skipped, and "skipped: …"
(`d-chart-frame__skipped`) in place of the chart.
`FiltersModel.fields` holds `{fieldId, op, value}[]` in the order added; `add(fieldId, op, value)` adds one (once:
the same id, op and value again is no change), `remove(index)` and `clear()` take them away, and `add(condition)` with
one argument still adds to the free SQL alone (filter buttons, the table's cell menu until 6.6). The URL holds each as
one `f` (`?f=host:ne:a`), per page like `sql`: a page opens
with the `f` of its link, and the next page without them. Loading leaves out an `f` the server would refuse (no id, no
second colon, an op other than `eq` / `ne`). `requestParams()` sends them as `f` after `sql`. The widget context has
`ctx.addFilter(fieldId, op, value)`. The filter bar shows one chip per filter (id, `=` / `≠`, value, × removes it)
above the filter buttons, and is wanted while there is a chip; like the buttons, chips show only on a page with
`filterBar`. Playwright:
`e2e/filter-chips.spec.ts` (a chip from a link on `/clickhouse/table_sizes`, × and back); `@playwright/test` is not in
`package.json` yet, so `npm run e2e` needs `npm i -D @playwright/test` first.

✅ (step 6.6, superseded by 6.8) **A table cell adds a structured filter.** 6.6 put "Filter by" / "Exclude" into a
cell's menu; since 6.8 a click on a cell selects instead, and the menu keeps only the SQL entries no op says: "Filter:
Contains this value" (a SQL `LIKE`), for a timestamp column "Time ±5 minutes / ±1 hour / ±24 hours" (SQL until step
7, "Filter to window"). Debug's table selects nothing and keeps all SQL entries. A selected cell's
value is what Arrow gives the cell: a `DateTime` arrives as `Uint32` seconds, a `DateTime64(3)` as milliseconds; checked
on ClickHouse 25.10 (`clickhouse local`), `'1761730000'` as a `String` parameter equals that `DateTime` and
`'1761730000000'` that `DateTime64(3)`. The chip shows the number as it is, not the formatted time.

**Clicks select; a floating bar offers what to do** (as Zwiebelfisch's `visualEditor/selection` bar above a text
selection). A chart only reports a *selection*; it does not know what can be done with it:

- **Category** (series / fill, bar category, ordinal heatmap row, table cell): a click selects
  `{kind: 'category', fieldId, value}`, `fieldId` the field's alias. Measures (`count()` etc., known from the field's
  `kind`), time buckets and `timeHeatmap`'s bucketed numeric `y` are not selectable.
- **Time axis** (time bar, time line, heatmap x): hover moves the synchronized `cursor`; dragging selects
  `{kind: 'time', from, to}`, highlighted on every time chart; clicking one bucket selects that bucket. Plot has no
  brush: the pointer handling lives in a shared time-chart helper.

The selection is one model in the `widgets` host (one selection at a time, Escape clears it). The host shows the
floating bar `widget/selection` next to it; its entries come from `ui.registerMenuItem('widget/selection', …)`
with `when(context)` like any menu, so each extension adds its own:

| Entry | Shown when | From extension |
|---|---|---|
| Zoom | time | `time-range` (sets the time range) |
| Filter to window | time | `filters` (a `tw` chip: all charts filtered, time charts keep their axis at the page's range) |
| Filter by … / Exclude … | category | `filters` |
| Show rows | either, base table known | `row-details` (drill to detail, §6) |
| a Go action | as declared (§3.9) | `page-actions` |
| Open in Explore | either | `explore` (later) |

So "both zoom and filter" is no either-or: they are two entries, and later ones (drill-down, actions) need no new UI.

✅ (step 6.7) **The floating bar, the selection, and bar charts select.** `ui.registerFloatingBar({id, title, order?,
anchor})` gives a `FloatingBar<C>` its owner drives, `show(context)` / `hide()` / `dispose()` (the sketch had a
`Disposable`: someone has to say which context it is shown for). It is a `role="toolbar"` row of the entries of the
menu `id` whose `when` holds in the context, `title` its accessible name. It sits above the anchor's box, or below it
where there is no room, and stays inside the viewport. It takes no focus and has no press-outside handling of its own:
it stays until its owner hides it. It is placed again on every scroll and resize and when its menu changes, and hidden
while `anchor` gives `null` or no entry applies. A chosen entry's command runs with the context. Of two bars, the
higher `order` lies on top. The `widgets` host registers `widget/selection` ("Selection"), its anchor the box of the
selection's `anchor` element while that element is in the page. The selection is `{kind: 'category', widgetId,
fieldId, value, anchor}`: `ctx.select` takes it without `widgetId`, which the host fills in from the widget's
`dataUrl` (`3`, as "Copy link to chart"). `WidgetsApi` has `selection` and `clearSelection()` for the extensions, and
`ctx.clearSelection()` ends it as well. A new selection ends the one before. So do Escape, any click (listened for in
the capture phase, so the click on another bar ends the old one and selects anew, and a click on an entry still runs
it), and disposing the widget that holds it. `filters` registers "Filter by" (`filters.filterBySelection`) and
"Exclude" (`filters.excludeSelection`) for `kind === 'category'`; they call `query.filters.add(fieldId, 'eq' | 'ne',
value)` and `widgets.clearSelection()`. The entries' titles do not repeat the value: the bar sits next to the clicked
bar. `chart-library/selectBars` (from 6.8 `selectMarks`) makes the bars of a Plot bar chart selectable. On a click
on a bar (Plot binds each `rect` to its row's index), it selects the value in that row of the first of the given fields
that is a category (by its alias): a bar chart's category (`x` / `y`), then its `fill`. A NULL selects nothing.
Without such a field the bars are not selectable and get no pointer cursor. `fx` / `fy` and the color legend are
6.8. Tests: `floating-bar.test.ts`, the selection in `widgets.test.ts`, the entries in `filters.test.ts`, a click to
a filter in `bar-vertical.test.ts`. The widget testbed now runs a real `UiHost` and `CommandsHost`. Playwright:
`e2e/bar-selection.spec.ts`. **Open:** a refresh redraws the chart, so the selected bar leaves the page. The bar
then hides at the next scroll or resize, but the selection stays until Escape or a click; the selected bar is not
highlighted.

✅ (step 6.8) **Every chart and table cell selects through the same bar.** `chart-library/selectMarks(chart, data,
fields, select)` replaces `selectBars`; a chart only says which field each of its parts selects:
`{marks: {<Plot aria-label>: [fields…]}, legend, fx, fy}`. A field selects when it is a category: not a `count`, not
a time bucket (`autoBucket`, or a field with `xBucketSizeMs`); its alias is the filter id. A NULL selects nothing, and
of a mark's fields the first category wins. It reads the value
from what Plot binds: a mark's `rect` / `path` to its row's index (a line's `path` to its points' indexes, the first
is taken), a color legend's swatch to its value, a facet label's `text` to its facet group's `{x, y}`. Every part that
selects gets `d-select-marks__item` (pointer cursor; the chart `d-select-marks`). The mapping per chart:

| Chart | Marks | Legend | Facets |
|---|---|---|---|
| `barVertical` | `bar`: `x`, then `fill` | `fill`, else `x` when `fx` colors the bars by it | `fx`, `fy` |
| `barHorizontal` | `bar`: `y`, then `fill` | `fill` | — (its drawing has no facets) |
| `timeBar` | `rect`: `fill` | `fill` | `fx`, `fy` |
| `timeLine` | `line`: `zField`, then `strokeField` | `strokeField` | `fx`, `fy` |
| `timeHeatmapOrdinal` | `bar` (its cells): `y` | — (the legend is the measure) | — |

`timeHeatmap` selects nothing: its `y` is a numeric bucket and its `fill` a measure. A line selects its own series
(`zField`) before its color group (`strokeField`), as a bar its category before its fill; the legend shows the
`strokeField`. **A time chart's drag area (`timeBrush`) lies above its marks**, so a click there lands on the area,
not on a bar: `selectMarks` then takes the topmost selectable element below the pointer
(`document.elementsFromPoint`). A click without moving starts no time selection, and `timeBrush` is unchanged; the
marks below the area show no pointer cursor. The table: `drawTable(result, props, select?)`; with `select`, a click
on a cell of a category column (Tabulator's `cellClick`) selects `{fieldId: the column's name, value: String(cell),
anchor: the cell}`, a NULL nothing, and the category columns carry `d-table__selectable`. A table's props carry
`categories` (step 6.9, its `computeProps`): the aliases of its own fields (`dimensions()`) that are categories, so
its GROUP BY fields, or all its selects for raw rows, without counts and time buckets. A column Arrow types as map,
list or struct holds no category on the client either. **Deviation:** a SQL-file table has no categories, since its
output columns are only in its text, so its cells select nothing (open question 8). The 6.6 entries "Filter by …" /
"Exclude …" leave the cell menu: it keeps "Filter: Contains this value", a timestamp column its "Time ±…" entries.
`dashica-add-filter` carries only SQL conditions again. Debug's table passes no `select`, selects nothing and keeps
all its SQL entries. Tests: a click per chart type in its extension's test (marks, swatch, facet label; the drag area
with a stubbed `elementsFromPoint` in `time-bar.test.ts`), the cell click, the category columns and the menus in
`table.test.ts`, the categories in `table_test.go`. Playwright: `e2e/bar-selection.spec.ts` (selector
`d-select-marks__item`), `e2e/chart-selection.spec.ts` (a time bar's swatch, a table cell, the cell menu). **Open:** the
ordinal heatmap's y-axis labels and a table's header do not select; a click that ends a text selection in a table cell
also selects the cell.

### 3.9 Go actions

An action is **a plain `http.HandlerFunc`** plus what the menu needs to show it: `.Action(id, title, where,
handler)`, `where` = page title, chart selection or table row. It is mounted as `POST <page>/action/<id>` and listed in
`page.json` (id, title, where); one client extension registers it as a command and menu item. No action framework:

- **Request:** the client POSTs the menu's context as JSON (the selection, the row) with the page's query string
  (time, filters); the handler reads `r` as any handler.
- **Response:** a 2xx JSON body with optional fields `{message, navigate, refresh}` (notification, navigation,
  re-query); anything else shows the body as an error notification. One small helper writes that body; a handler may
  also write it itself.

Pure UI behaviour (palette, keys, panels) stays TS.

### 3.10 Errors and tests

- **Errors where they happen:** a query error shows in its chart (short message; "details" opens Debug) and is
  counted in the status bar; an action or navigation error is a notification; an unknown page shows "not found" in
  the content area. Nothing modal.
- **Tests:** vitest (jsdom) for core, hosts and extensions through their public interface; Go golden JSON for the
  contract (§3.3); Go tests for `QueryState` parsing and the default filter helper (a fixed column list, no ClickHouse); Playwright specs for flows (written
  by the agent, run by the maintainer: the sandbox cannot launch browsers).
- **Comments** (as in Zwiebelfisch, checked by `mise run quality:top-comments` for `frontend/core`, `frontend/hosts`,
  `frontend/extensions`):
  - *One "why" comment per concept:* the doc comment of the main element (the first export) of a module's entry file.
    First line: what it is. Then who uses it and what it guarantees, concretely. Under ~10 lines. No rationale, no
    neighbours, no "see also", no history, no references to where the design came from (VS Code, Zwiebelfisch).
  - *Every other file points to it:* first line `See <Name> in <path>`; a test file starts `Tests for X`.
  - *API doc comments* say what a parameter or result means; never restate the code or the name. No comment is better
    than one that says nothing.
  - *Say what it is, not what it is not* ("not part of the HTTP contract", "no editor sees it"): a reader cannot
    act on a negation.
  - *Examples are Dashica's* (`timeRange.refresh`, dashboards, charts), never ported ones.

### 3.11 Sketch: TypeScript extension points

```ts
// frontend/hosts/extension-host — what every extension gets
interface Extension {
  readonly id: string;
  readonly contributes?: { commands?: CommandContribution[]; keybindings?: KeybindingContribution[] };
  activate(context: ExtensionContext): void;
}

interface ExtensionContext {
  readonly subscriptions: Disposable[];   // disposed in reverse order
  readonly globalState: Memento;          // per viewer (localStorage), scoped by extension id
  readonly workspaceState: Memento;       // per browser session (sessionStorage)
  readonly commands: Commands;
  readonly ui: UiApi;                     // not `window`: that would hide the browser's
  readonly page: PageApi;
  readonly query: QueryApi;
  readonly widgets: WidgetsApi;
}

// commands — as Zwiebelfisch
interface Commands {
  registerCommand(id: string, handler: (...args: any[]) => unknown): Disposable;
  executeCommand<T>(id: string, ...args: unknown[]): Promise<T>;
  getCommands(): readonly CommandContribution[];      // what the palette lists
  keybindingLabel(id: string): string | undefined;
}

// ui — regions, menus, input, messages
interface UiApi {
  registerSidePanel(id: string, o: { label: string; icon: string; side: 'left' | 'right'; order?: number;
                                     when?: (p: Page) => boolean }): Panel;     // command workbench.view.<id>
  registerBottomPanel(id: string, o: { label: string; order?: number; when?: (p: Page) => boolean }): Panel;
  registerBarItem(bar: 'title' | 'filter' | 'status', el: HTMLElement,
                  o: { alignment: 'left' | 'right'; priority?: number }): Disposable;

  registerMenuItem<C>(menuId: string, item: MenuItem<C>): Disposable;    // when / enabled / toggled / group / order
  getMenuItems<C>(menuId: string, context?: C): readonly MenuItem<C>[];
  showContextMenu(menuId: string, o: { anchor: Element | {x: number; y: number}; context?: object; args?: unknown[] }): void;
  readonly onDidChangeMenu: Event<string>;
  registerFloatingBar<C>(o: { id: string; title: string; order?: number;
                              anchor: (context: C) => DOMRect | null }): FloatingBar<C>;   // entries via registerMenuItem(id, …);
                                                                                          // show(context) / hide() / dispose()

  createQuickPick<T>(): QuickPick<T>;     // the owner sets the items as the text changes (search everywhere)
  // later, with their first user: showQuickPick (a fixed list, filtered by the box), showInputBox
  registerSearchProvider(p: SearchProvider): Disposable;               // search everywhere groups
  showInformationMessage / showWarningMessage / showErrorMessage(message: string, ...items): Promise<…>;
}

interface Panel extends Disposable {
  readonly body: HTMLElement; readonly visible: boolean;
  show(): void; hide(): void; readonly onDidChangeVisibility: Event<void>;
}

// page — what the content area shows
interface PageApi {
  readonly workbench: WorkbenchJson;        // menu groups and outlines, from /workbench.json (generated type, §3.2)
  readonly current: PageJson | undefined;   // from <url>/page.json (generated type); undefined while it failed
  readonly onDidChangePage: Event<PageJson>;
  navigate(url: string): Promise<void>;     // fetch page.json, pushState, swap content
  registerPageRenderer(kind: string, render: (el: HTMLElement, page: PageJson) => Disposable): Disposable;
}                                           // `dashboard` by the extension dashboardPage, later `explore`

// query — the state every query depends on (§3.7)
interface QueryApi {
  readonly time: TimeModel;                 // range, auto refresh; per page, URL-synced
  readonly filters: FilterModel;            // {fieldId, op, value}[] + time window + free SQL; URL-synced
  readonly params: ParamsModel;             // form widget values; URL-synced
  readonly cursor: CursorModel;             // hovered timestamp, synchronized across time charts (step 7)
  refresh(): void;
  readonly onDidRequestRefresh: Event<void>;
  requestParams(): URLSearchParams;         // what every data handler reads; one format with step 6
}

// widgets — renderers per widget type (§3.6)
interface WidgetsApi {
  registerWidget<T extends WidgetType>(type: T, render: (el: HTMLElement, w: WidgetOf<T>, ctx: WidgetContext) => Disposable): Disposable;
  readonly statuses: ReadonlyMap<string, WidgetStatus>;   // for the status bar
  readonly onDidChangeStatus: Event<void>;
}
```

Menus open from a visible button ("…", or the widget's menu button), never by a right click: on the web nobody
expects one. Menu ids: `page/title` (page actions), `widget/context` (a chart's menu: debug), `widget/selection` (the floating bar
on a chart selection: zoom, filter, show rows, actions), `table/row` (a row's menu),
`dashboards/entry` (a menu entry: favorite).

Folders as in Zwiebelfisch: `frontend/core/<name>/` (primitives), `frontend/hosts/<name>/` (contribution points),
`frontend/extensions/<name>/` (one folder per built-in extension); `frontend/workbench/` puts hosts and extensions
together (`createWorkbench`). Tests sit next to the code (`<name>.test.ts`).

Built-in extensions:

| Extension | Contributes |
|---|---|
| `dashboards` | left panel "Dashboards" (groups, favorites, filter box) |
| `search-everywhere` | the palette (⌘K / Shift Shift): pages, commands, favorites, chart titles |
| `time-range` | title bar: the range button with its panel (quick ranges, From / To, recently used), shift ‹ ›, zoom out ⊖, refresh (§3.7); `widget/selection` "Zoom" |
| `refresh` | title bar: one split button, ⟳ refresh now (`refresh.now`) and the auto refresh interval (Off, 10s … 1h) |
| (log scale) | removed (decided 2026-10-30): the charts draw on a linear scale |
| `theme` | light / dark toggle |
| `filters` | filter bar: chips, filter buttons, SQL chip; `widget/selection` "Filter by …" / "Exclude …" / "Filter to window" |
| `query-status` | status bar: queries, loading, failed, timings |
| `debug` | bottom panel "Debug" (query, EXPLAIN); `widget/context` "Debug" |
| `chart-link` | `widget/context` "Copy link to chart" (`/p/shop#w=3`) |
| `row-details` | `table/row` "Details" and `widget/selection` "Show rows" → bottom panel |
| `page-actions` | Go actions from `page.json` → commands + menu items |
| one per widget type: `time-bar`, `time-line`, `bar-vertical`, `bar-horizontal`, `heatmap`, `stats`, `table`, `markdown`, `checkbox-group`, `text-input`, `grid`, `collapsible`, `alerts`, … | `registerWidget` for its type, its CSS, its own menu items |

Favorites stay inside `dashboards` (separating them would need a contribution point inside the Dashboards panel).

**Chart titles in search everywhere** (decided 2026-10-30): the charts are the pages' outlines in `workbench.json`
(§3.2), `{id, title, group}` per menu entry. The builder API stays as it is. A result shows
`page › group › title`; pages rank before charts, the current page's charts before other pages' (the same titles
repeat across template dashboards).

A result is a link `/p/shop#w=3` through `navigate`, and the same link is what "Copy link to chart" copies. When the
page has rendered, the dashboard page opens the collapsible groups around the chart (a closed group does not query),
scrolls the chart into view and highlights it briefly; on the current page without a reload. A link breaks when the
page is reordered and the chart has no `.Id(…)`: accepted.

✅ As implemented (6a): the outline (§3.2). The charts are a group of `search-everywhere` ("Charts", after
"Dashboards"), matched there so the page shown comes first. A widget with data carries `data-data-url` on its element,
where the dashboard page finds it. `navigate` to a hash on the page shown (a link without a query keeps the page's)
pushes the hash and fires `hashchange`, without loading `page.json`. A change of only the hash by the browser (a link
`#w=3` in the page, a typed hash, back and forward between two) neither loads `page.json` nor queries again: the
`query` host knows the query string it last read or wrote, and the browser fires `hashchange` itself. A load of
another page still running is aborted by either. The charts come in the order they were mounted (a grid's by
area name). "Copy link to chart" copies the page and the hash without the query state; the
next change of the query state drops the hash from the URL.

### 3.12 Sketch: Go changes

```go
// lib/dashboard/widget — a widget implements only what it has (§3.13); the rest is the framework's Mount
type WidgetDefinition interface{} // what it has: the optional interfaces below; its type name: Register

// withProps is a widget's props: its fields tagged dashica-gen:"client", generated for every registered widget; not
// part of WidgetDefinition, since the package must compile without zz_generated.dashica.go for dashica-gen to load it
type withProps interface {
	marshalProps() ([]byte, error)
}

// withHandler is a widget with data: its handler answers the requests below its URL ("/query", "/viewer/index.html").
type withHandler interface {
	Handler(deps rendering.Dependencies) http.Handler
}

// withChildren is a widget that lays out other widgets: a grid's areas by name, a group's widgets by position.
type withChildren interface {
	Children() iter.Seq2[string, WidgetDefinition]
}

// withQuery is a chart: Mount serves its query ("GET /query" Arrow, "GET /debug" the query and EXPLAIN) (step 6.2)
type withQuery interface {
	Query() sql.SqlQueryable
}

func (b *TimeBar) Query() sql.SqlQueryable { return b.sql }

// withFilters is a chart that interprets the request's filters itself (§3.8); every other chart gets filter.Apply
type withFilters interface {
	ApplyFilters(q sql.SqlQueryable, filters []filter.Filter) (sql.SqlQueryable, filter.Diagnostics)
}

// lib/dashboard/filter — new, pure: what a chart did with the filters, and the default way to do it
type Diagnostics struct {
	Ignored []string `json:"ignored,omitempty"` // filter ids the chart does not interpret, in URL order
	Skipped string   `json:"skipped,omitempty"` // non-empty: the chart did not run, and why
}
type Filter struct{ ID, Op, Value string }                                   // `f=host:eq:a`; QueryState.Filters
type Columns func(ctx context.Context, server, table string) ([]string, error) // DESCRIBE TABLE, cached
func Apply(ctx context.Context, q sql.SqlQueryable, fields []sql.SqlField, filters []Filter, columns Columns) (sql.SqlQueryable, Diagnostics, error)
func Condition(i int, f Filter, expression string) string                      // `(status) = {__f0:String}`

// a grid: its areas sorted by name, so the ids stay the same from one start to the next
func (g *Grid) Children() iter.Seq2[string, WidgetDefinition] { return g.areas.all() }

// Mount is the Node of `w` for page.json, the one place that knows URLs, ids and the Node: its type from the registry,
// its props; a withHandler at "<page>/api/<id>/" (http.StripPrefix, id: the author's `.Id(…)`, else the page's
// next number) with that URL as dataUrl; a withChildren's children mounted the same way, in the order it yields them.
func Mount(ctx *rendering.DashboardContext, api handler_collector.HandlerCollector, w WidgetDefinition) (Node, error)

type Node struct {
	Type     string          `json:"type"`
	Props    json.RawMessage `json:"props"`              // its fields tagged `dashica-gen:"client"`
	DataURL  string          `json:"dataUrl,omitempty"`  // "<page>/api/<id>": its handler answers below it
	Children map[string]Node `json:"children,omitempty"` // grid areas by name; collapsible: "0", "1", …
}

// lib/dashboard — the Builder serves the shell, page.json and actions
func (d *Builder) CollectHandlers(ctx *rendering.DashboardContext, h handler_collector.HandlerCollector) error {
	nodes, err := d.widgets.Mount(ctx, h.Nested("/api"))       // widget.Mount for each: /api/<id>/…
	page := PageJson{Kind: "dashboard", Title: d.title, DefaultTime: d.defaultTime,
		FilterButtons: …, Actions: d.actions.Describe(), Widgets: nodes}
	h.HandleRoot(shell.Handler)                                 // the one static shell HTML
	h.Handle("page.json", jsonHandler(page))
	d.actions.Mount(h.Nested("action"))                          // POST action/<id>
}

// lib/dashboard/action — new
type Definition struct {
	ID, Title string
	Where     Placement           // PageTitle | WidgetSelection | TableRow
	Handler   http.HandlerFunc    // body: the menu's context as JSON; query string: time, filters
}
// the response body the client understands (2xx); a generated TS DTO
type Result struct {
	Message  string `json:"message,omitempty"`
	Navigate string `json:"navigate,omitempty"`
	Refresh  bool   `json:"refresh,omitempty"`
}
func Respond(w http.ResponseWriter, r Result)    // the one helper: writes Result as JSON
```

| Where | Change |
|---|---|
| `dashica.go` | `GET /workbench.json` (§3.2): the groups as `RegisterDashboardGroup` starts them, each page's menu entry with `widget.Outline(page.Widgets)` of the `PageJson` its `CollectHandlers` returns |
| `lib/dashboard` | `Builder.CollectHandlers` as above; `.DefaultTimeRange(...)`, `.Action(...)` |
| `lib/dashboard/widget` | `BuildComponents` + `CollectHandlers` → `withHandler` / `withChildren` and the framework's `Mount` (§3.13), `RegisterQueryHandlers` → `queryHandler`; ids assigned by the framework; markdown computes its HTML when mounted (`computeProps`), the schema table serves its DDL from its handler; charts implement `Query()`, optionally `ApplyFilters`; `DataHandler(deps, w)` |
| `lib/dashboard/filter` | new, pure: `Diagnostics`, the default helper `Apply` (own fields by alias, then base-table columns; SQL files: own output columns), its column source a function value |
| `lib/dashboard/rendering` | `DashboardContext` loses `MainMenu` / layout concerns; `SearchBarOption` becomes `page.json` fields |
| `lib/httpserver` | `QueryState` (time, `f`, `tw`, `sql`, `wp`) parsed once; the query handler asks the chart for its filtered query and Diagnostics, binds every filter's value (`__f<i>`) and writes `X-Dashica-Diagnostics`; a skipped chart runs no query |
| `lib/clickhouse` | `DESCRIBE TABLE` columns, cached per server, database and table until restart |
| `cmd/dashica-gen` | additionally emits `zz_generated.dashica.ts` (widget union, DTOs) and golden JSON fixtures |
| deleted | `lib/components/**` (templ), Alpine, dockview, `lib/explore` + `frontend/explore` (rebuilt later, §6) |

### 3.13 Widgets implement standard interfaces; the framework mounts

Today every widget walks the tree twice, `BuildComponents` (HTML) and `CollectHandlers` (HTTP), and both passes must
agree on the widget id: whichever runs first calls `ctx.NextWidgetId()` and stores it in the widget (`b.id = …`),
mutating an otherwise immutable builder. Order and mutation are the coupling.

A widget has at most three things the page needs, and each is a standard library type:

| What | Interface | Who |
|---|---|---|
| props | its fields tagged `dashica-gen:"client"` (the generated `marshalProps`) | every widget |
| data | a chart: `Query() sql.SqlQueryable`, served by the framework's `queryHandler` (from 6.2); else `Handler(deps) http.Handler`, routed inside by an `http.ServeMux` | `Query`: the eight charts (`TimeBar`, `TimeLine`, `BarVertical`, `BarHorizontal`, `TimeHeatmap`, `TimeHeatmapOrdinal`, `Stats`, `Table`); `Handler`: `AlertOverview`, `AlertDetail`, `SpeedscopeLink`, `SchemaTable` (`/schema`) |
| children | `Children() iter.Seq2[string, WidgetDefinition]` | `Grid` (areas by name, sorted), `CollapsibleGroup` ("0", "1", …) |

Everything else is **one** framework function, `widget.Mount`: the type name from the registry, the id, the URL, the
registration and the Node. A widget never sees the handler collector, its id or its URL; it is tested alone with
`httptest` (`GET /query`). `TextInput` and `CheckboxGroup` implement nothing beyond their JSON.

| Option | For | Against |
|---|---|---|
| **Standard interfaces + one framework `Mount` (recommended)** | no own API to learn; URL, id and Node in one place; a widget is an ordinary `http.Handler`; the type name cannot be mistyped | what a widget does is spread over optional interfaces: forgetting `Handler` goes unnoticed by the compiler (the golden contract test shows a chart without `dataUrl`) |
| A `Mount` method per widget, with helpers (`MountQuery`, `mountWithHandlers`) | everything a widget does in one method | each widget passes the collector, its type string and the Node through; registration, error checks and `DataURL` repeated per widget |
| Two methods, `Describe` + `CollectHandlers` | describe without HTTP | the two-pass id coupling stays, only with JSON instead of templ |
| Widgets declare only a query; the framework builds all handlers | widgets never touch HTTP | does not fit `AlertOverview` / `AlertDetail` (alert storage client), `SpeedscopeLink` (serves a viewer FS) |

`Handler(deps)` is not a standard signature: as an `http.Handler` itself (`ServeHTTP`) the widget would lack the
ClickHouse manager and logger at request time, and passing them through `r.Context()` is implicit.

**Props are opt-in:** a field reaches the client only when tagged `dashica-gen:"client"`; every other field (the query,
anything added later) stays on the server, so forgetting the tag hides a field instead of leaking it. dashica-gen emits
`marshalProps` and the TypeScript `XxxProps` from the same tagged fields, so Go and TS cannot disagree; a query or
children field with the tag is a generator error. The tag, not `json:"…"`: the fields are unexported, so `go vet`
refuses a json tag on them, and the widget's JSON (`MarshalJSON`, all fields) is what Explore exports.

Open in this design:

1. **Positions as keys:** `CollapsibleGroup` yields "0", "1", … (`Widgets.all`, since `slices.All` yields `int`).
2. **The chart's query** (§3.8): `queryHandler` hides the query, so a chart also says it (`Query() sql.SqlQueryable`),
   which the framework turns into the handler; the handler applies the request's filters to it (`ApplyFilters`, else
   `filter.Apply`); then `Handler` is left for the special widgets. ✅ Done in step 6.2: each chart's `Query()` is the query it runs,
   with its own selects (`Stats`' title and fill fields, `Table`'s `Limit`); `widget.DataHandler(deps, w)` is
   `queryHandler(deps, w.Query())` for a chart, `w.Handler(deps)` for the others, and both `Mount` and Explore's
   preview serve it (✅ 6.3: the handler asks the chart for its filtered query, `ApplyFilters` or `filter.Apply` with
   `deps.ClickhouseClientManager.Columns`); dashica-gen gives a widget `dataUrl` when it has `Query` or `Handler`. The charts are eight,
   not nine.
3. **Field expressions:** `x` / `y` / `fill` are tagged `client` and went out as `SqlField` with their expression
   (`JSONExtractString(attrs,'host')`); §3.8 says expressions never leave the server. ✅ Done in step 6.9: the
   generated `marshalProps` write each field slot with `sql.MarshalFieldProps` as `{kind, alias, xBucketSizeMs?}`
   (TS `SqlFieldProps`), never its definition or an AutoBucket's column. `kind` stays because the client reads it:
   `selectMarks` never selects a count. The widget's JSON (`MarshalJSON`, all fields) is unchanged; Explore's Go code
   reads that, nothing reads the props. A field without an alias (`sql.Field("lower(host)")`) is aliased by its
   definition, as its result column is named; such an alias still shows the expression, so give it an alias.

## 4. Alternatives considered

| Alternative | Why rejected |
|---|---|
| Keep server rendering (templ + Alpine) | templ only emits JSON containers and chrome the workbench replaces; two render paths (compiled vs Explore) remain |
| htmx | a third technology for almost nothing; charts are client-rendered anyway |
| dockview | open-core since v8 (`dockview-enterprise` proprietary); we used a sliver of it; free docking does not fit fixed regions |
| Alpine / a reactivity library | the Explore reactive rewrite hit every proxy trap (defocus by tracked reads, `raw()` for the JSON tab, effect lifetimes via `Alpine.release`, proxy identity); Arrow tables must never be proxied |
| Central API (`/api/...` for all pages) | loses per-page subtrees for access control; no gain over recursive mounting |
| `tygo` next to `dashica-gen` | two generators for one contract |
| Schema-first (OpenAPI, protobuf) | heaviest; fights the Go-first builder |
| Widgets as classes with `update(props)` | Plot redraws anyway; dispose + render is simpler |
| Host wraps every widget in a frame | containers and markdown don't want one; leads to `frame: false` options |
| Filters as raw expressions in the URL | client-sent SQL everywhere; blocks permissions later (§6); ids + bound values cost little |
| `additional_table_filters` (as Grafana's ClickHouse plugin) | ClickHouse applies it at every read of the table, also in subqueries where a filter must not apply; complex queries need to say *where* filters go, hence `{{DASHICA_FILTERS}}` |
| Parsing queries (SQL AST) | not needed: a chart knows its own fields, `DESCRIBE TABLE` its base table's columns; ClickHouse's JSON AST (`clickhouse_json` dialect) is unverified as released and would tie us to ClickHouse |
| Drop non-applicable filters silently / fail the chart | silent is misleading; failing hides useful data. The chart's Diagnostics + badge instead (§3.8) |
| A page-wide registry of filter fields (collected at mount, id → expression, a conflict check across charts) | state gathered in a shared object, read per request; template dashboards over several tables give the same alias two expressions. The chart interprets the filters at execution and returns what it did (§3.8) |
| Time range global across pages | Grafana-style per-page default is what dashboards expect; links can still carry `?time=` |
| Tabs inside the app | browser tabs do that |

## 5. Migration and risks

Replace in place on `feature/workbench`; merge to `main` at the end. Every step up to 5b.4 left the dashboards working.
From 5b.5 on, the old page is deleted first and the dashboards do not work until the switch (5b.9): no adapter keeps
the old page alive, and every commit leaves less code behind it (decided 2026-10-29). Check both instances with
`mise run up` after the switch.

**Working mode:** the agent may commit (this overrides "no commits" in `dashica-src/CLAUDE.md` for this branch), but
**stops after every commit and waits for the maintainer's review** before the next one. Commits stay small (one step,
or a part of one), so deviations from this concept, problems and naming issues are caught as early as possible. A
deviation found while implementing is raised before committing, not decided silently; agreed changes go into this
document in the same commit.

**Step 6 runs as sub-steps** (decided 2026-10-30): 6.1 … 6.9 below, in order, each its own commit that leaves the
dashboards working and checks its row off. The agent goes on to the next sub-step without waiting; the maintainer
reviews the commits asynchronously afterwards, one by one. A deviation from this concept is still written into this
document in the commit that makes it, and listed in the commit message, so the review finds it.

**Nothing gets lost:** every frontend file from before the workbench (`frontend/**/*.ts`, `*.js`, outside
`frontend/core`, `frontend/hosts`, `frontend/extensions`) starts with `// UNMIGRATED (workbench): …`. A step that ports,
rewrites or deliberately deletes a file's content removes the marker (or the file) in the same commit, and says in the
commit message where the content went. Before the merge, `grep -rl UNMIGRATED frontend` must be empty.

**Explore's Go API is kept, marked deprecated:** its UI is gone with step 3a; its Go code (`lib/explore`, the form
model, the Go-code emitter, open-in-explore, the generator parts for both) stays for the rebuild (§6). Whole files start
with `// DEPRECATED (workbench): …`; Explore-only symbols in shared files carry Go's `Deprecated: (workbench) …`
paragraph, so editors and linters flag their use. These may outlive the merge; the Explore rebuild ports or deletes
each, until `rg -i 'deprecated:? \(workbench\)'` is empty. `/explore` shows "Explore is being rebuilt" meanwhile.

| Step | Change | Works afterwards |
|---|---|---|
| 1 ✅ | Core: `Disposable`, `Event` / `EventEmitter` (from Zwiebelfisch), vitest (`npm test`) | everything; nothing visible |
| 2 ✅ | Commands + extension host: `registerCommand` / `executeCommand`, contributions, `activate`, mementos (`dashica:global:<ext>:` / `dashica:session:<ext>:`); not wired into the page yet | everything |
| 3a ✅ | **Explore UI removed** (`frontend/explore`, editor page, Explore links); its Go API kept and marked deprecated; `/explore` shows a rebuild notice | dashboards (unchanged) |
| 3b ✅ | Window layout replacing dockview: `WindowLayout` / `SideBar`, bottom panel, title / filter / status bars around the server-rendered content; the bridge extension `legacy-page` (UNMIGRATED, deleted in 5b) moves menu, search bar and debug drawer into them; dockview uninstalled | dashboards (old content inside the new chrome) |
| 4 ✅ | Menus + palette: `registerMenuItem` / `showContextMenu` (first user: a dashboard entry's "…"); `createQuickPick`; search everywhere (⌘K) over dashboards and commands replaces `sidebarSearch` | dashboards |
| 5a ✅ | Contract: `page.json`, `workbench.json`, `dashica-gen` TS + golden fixtures; served next to the old pages | dashboards; nothing visible changes |
| 5b ✅ | Client rendering: widget host, one extension per widget type (its chart ported from `frontend/chart/*`), client-side navigation, per-page default time; templ chrome and Alpine removed | dashboards, now client-rendered |
| 5b.1 ✅ | `query` host: time, auto refresh, SQL filter, params, view options, synced with the URL | dashboards (not used yet) |
| 5b.2 ✅ | `widgets` host: `registerWidget`, the widget context (`query()`, `renderChild`, the widget menu), `ChartFrame` | dashboards (not used yet) |
| 5b.3 ✅ | Go: markdown's HTML in its props (`computeProps`), the schema table serves its DDL from its handler; `.DefaultTimeRange(…)` in `page.json` | dashboards |
| 5b.4 ✅ | widget extensions: grid, collapsible, markdown, schema table | dashboards (not used yet) |
| 5b.5 ✅ | the old page deleted (`frontend/components`, `legacy-page`, Alpine, the old store); widget extensions: the charts, stats, table, alerts, each chart of `frontend/chart/*` ported into its extension and taking its generated props, shared helpers in `chart-library` | nothing: the dashboards are blank until 5b.9 |
| 5b.6 ✅ | widget extensions: checkbox group, text input, Speedscope link | nothing (until 5b.9) |
| 5b.7 ✅ | `page` host: `workbench.json`, `page.json`, `navigate`; the extension that renders a dashboard page | nothing (until 5b.9) |
| 5b.8 ✅ | extensions `dashboards`, `time-range`, `refresh`, `filters`, `debug` | nothing (until 5b.9) |
| 5b.9 ✅ | **the switch:** `/p/<page>` serves the shell, the client renders `page.json` | dashboards, now client-rendered |
| 5b.10 ✅ | `BuildComponents` (the widgets' old server props) and templ removed | dashboards |
| 6 | `QueryState` + structured filters (§3.8), alerts on `time`; in sub-steps, each its own commit | filters as chips, click-to-filter |
| 6.1 ✅ | Go `QueryState` (`time`, `range`, `sql`, `wp`) parsed once per request in `lib/httpserver`; every handler (query, debug, alert overview + chart, Speedscope, `/time-range`) reads it, `DashboardFilters` / the `filters` and `params` JSON are gone; the client sends the page URL's keys (`requestParams`); alerts read only `time` | dashboards, alerts |
| 6.2 ✅ | charts implement `Query() sql.SqlQueryable` (the query they run, with their own selects); `Mount` serves it through `queryHandler`; `Handler` is left for alerts, Speedscope, schema table | dashboards (refactor only) |
| 6.3 ✅ | the chart interprets the filters (§3.8): optional `ApplyFilters`, the default helper `lib/dashboard/filter.Apply` (own fields by alias, then base-table columns from a cached `DESCRIBE TABLE`; SQL files: own output columns; measures and time buckets never), `Diagnostics` (`ignored`, `skipped`); no page-wide registry: `DashboardContext.AddFilterFields` / `FilterFields` / `FilterScope` / `FilterTarget`, `page.json` `filterFields` and the Nodes' `filters` go; generator + golden fixtures regenerated | dashboards; both instances register, no dashboard changes in the outer repo |
| 6.4 ✅ | `?f=id:op:value` (`eq`, `ne`) in `QueryState` (✅ kept); the query handler calls the chart's `ApplyFilters` or `filter.Apply`, binds each filter's value as `{__f<i>:String}`, writes `X-Dashica-Diagnostics` (JSON, replacing `X-Dashica-Ignored-Filters`) and answers a skipped chart without running ClickHouse; Debug shows the filter clause, its parameters and the Diagnostics | dashboards; filters by hand-written URL |
| 6.5 ✅ | client: `FiltersModel` holds `{fieldId, op, value}[]` (URL `f`, `requestParams`), `ctx.addFilter`; the filter bar shows them as chips (id, = / ≠, value, ×); `ChartFrame` shows "ignores `host`" / "skipped: …" from `X-Dashica-Diagnostics` | filters as chips (from links) |
| 6.6 ✅ | table: a cell adds a structured filter; superseded by 6.8 (a click selects; the menu keeps "Contains" and the timestamp entries (±5 min …) in SQL until step 7) | click-to-filter in tables |
| 6.7 ✅ | `ui.registerFloatingBar` (menu `widget/selection`); the selection model in the `widgets` host (one selection, Escape clears, `ctx.select`); `filters` contributes "Filter by …" / "Exclude …" for `category`; first users: bar vertical / horizontal (category, fill), selected by the field's alias | click-to-filter on bar charts |
| 6.8 ✅ | the other charts select categories: time bar / time line series (fill, stroke, z), ordinal heatmap rows, `fx` / `fy` facets; table cells select through the same bar (every column, by its name; §7, 8), replacing the cell menu's entries of 6.6; a category field selects by its alias, never a measure or a time bucket | click-to-filter everywhere |
| 6.9 ✅ | props carry aliases (§3.13, 3): client `SqlField` slots go out as `{kind, alias, xBucketSizeMs?}`, never the definition; generator, TS types and fixtures regenerated | dashboards; no expression in `page.json` |
| 6a ✅ | small, any time after 5b.9: queries stop with their client (§3.7), auto refresh pauses in a hidden tab, chart titles in search everywhere and chart links (§3.11) | |
| 7+ | each planned when we get there: time selection + synchronized cursor, Go actions, status bar query states, row details | |

| Risk | Mitigation |
|---|---|
| Step 5b is one big switch, with blank dashboards from 5b.5 to 5b.9 | 5a lands the contract first with golden tests; the charts are ported as they behave; Playwright flows before merge |
| Explore unavailable from step 3 until rebuilt | accepted: Explore is experimental; rebuilt after the merge (§6) |
| Long-lived branch drifts from `main` (new dashboards in the outer repo) | dashboards are Go only and keep their builder API; rebase regularly |
| Bound filter values typed `String` against numeric columns | ✅ checked on ClickHouse 25.9 (§3.8): converts; a value that does not convert fails that chart with `TYPE_MISMATCH`. Production runs 26.10: the integration test of 6.4 (`lib/httpserver/query_filters_e2e_test.go`) runs against CI's ClickHouse once CI's dashica-src test job sets `APP_ENV=testing_ci` (today it reads `dashica_config.testing.yaml`, `127.0.0.1:28123`) |
| The same alias means different things in two charts (template dashboards over several tables) | each chart interprets the id by its own definition or its base table's column; a chart without either reports it as ignored |
| `DESCRIBE TABLE` per base table | once per table and server, cached until restart; a schema change needs a restart |
| SELECT aliases in WHERE are ClickHouse-specific | only for SQL files, which are ClickHouse SQL anyway |
| Bookmarked inner URLs (debug links) break | accepted; entry-point URLs stay |
| Playwright cannot run in the sandbox | specs written by the agent, run by the maintainer |

**Bugs the ports keep:** a chart is ported as it behaves; a bug found on the way is listed here and fixed in a commit of
its own.

- Ordinal time heatmap: `color` and `colorScheme` are not used, the cells are always blues (inferno in dark mode)
  (`frontend/extensions/heatmap/heatmap.ts`).
- Stats: `fillField` is meant as a column with each number's color, but its alias is taken as the color itself
  (`frontend/extensions/stats/stats.ts`).

## 6. Later (out of scope, but the design must not block it)

- **Explore rebuilt** as extensions on `ExploreModel`: widget tree left, inspector right, Data / Go / JSON bottom, while
  `page.kind === 'explore'`. "Open in Explore" becomes a built-in action: `?source=/p/shop&widget=api/3`, Explore
  reads that widget from the source's `page.json` (no server state, no URL length issue). Persistence: localStorage +
  share link as today.
- **Drill-down: start at a chart, go ad hoc from there.** Two kinds, as Superset names them:
  - *Drill to detail:* a click on a bar / cell opens the bottom panel with the raw rows behind it: the chart's base
    table and WHERE, the page's filters and time, plus the clicked value (`SELECT * … LIMIT n`). Needs the base table,
    which builder queries know; SQL files declare none (§7, question 2), so they have no "Show rows".
  - *Drill by / ad hoc:* "Open in Explore" from a chart or dashboard carries the chart *and* the current `QueryState`
    (time, filters, params), so you narrow further, regroup by another field or add charts from there. Builds on the
    Explore rebuild below.

  What the design already gives: charts that interpret filters on their base table's columns (§3.8), one `QueryState` that travels in the URL, and
  `widget/context` / `table/row` menus as the entry points.
- **Permissions per dashboard**, with or without filtering. A middleware on a page's subtree; `/workbench.json` filters
  the menu per user. What the design already gives: structured filters carry only ids and bound values, so they cannot
  change a query; the free SQL chip is the only client-sent SQL, in one parameter (`sql`), parsed in one place, so it
  can be limited to an "advanced" role. Real protection for free SQL must sit in ClickHouse (a readonly user per role,
  grants, row policies, query limits), not in string checks.
- **MCP server with built-in anonymization**: sensitive data must never reach the cloud provider. What the design
  already gives: dashboards are machine-readable (`page.json`), and every query goes through one path (`QueryState` →
  handler), the single place where an anonymization step on results would sit.
- **Perspective instead of the Tabulator table** ([perspective-dev.github.io](https://perspective-dev.github.io/)):
  it reads Arrow, which the query results already are, and pivots, groups and filters in the browser. To check: what
  the table's own features (search highlight, sticky tooltips, record details, add-filter menus) cost to rebuild on it.
- Tabs inside the app; client extensions from the instances (outer repo); other database backends; query
  understanding (AST).

## 7. Open questions

1. **Time selection:** does "Filter to window" need its own chip, or is it a second, narrower time range?
2. ✅ **Filters on SQL files** (decided 2026-10-30): a SQL-file chart interprets filters only on its own output
   column names, which ClickHouse resolves in WHERE; no `.FilterAs` / `.AcceptFilter` / `sql.Table`. Every other
   filter is reported as ignored (§3.8).
3. **Alerts and filters:** should dashboard filters ever apply to alert widgets (e.g. only alerts of host `a`)? For
   now no.
4. **Drill-down:** is "drill to detail" (raw rows in the bottom panel) wanted early, before the Explore rebuild?
   What does ad hoc narrowing need beyond filters + Explore (e.g. regrouping a chart in place)?
5. **Permission model:** roles per dashboard subtree; who may use free SQL; how roles map to ClickHouse users.
6. **Anonymization:** declared per column in Go, or in ClickHouse; reversible (pseudonyms) or not.
7. ✅ **Who interprets a filter** (decided 2026-10-30): the chart, when it runs, in Go; it returns its Diagnostics.
   No page-wide registry of filter fields and no conflict check across charts (§3.8).
8. **Table cells of a SQL file:** a builder table selects in its category columns (6.9); a SQL-file table selects in
   none, since the server knows its output columns only from its text. Should such a table name its category
   columns in Go (`.Categories("host", "status")`), which it then interprets as its own output columns?
9. ✅ **A filter on a measure's alias** (6.9): a base-table column that a select of the chart's query aliases with
   another expression (`sum(bytes) AS bytes`) is ignored (§3.8).
