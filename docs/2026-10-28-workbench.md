# Workbench — application shell and extensions (technical concept)

Status: concept agreed 2026-10-28, not yet implemented. Branch `feature/workbench` in `dashica-src`; merges to
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
GET  /workbench.json               menu groups, Explore URL; fetched once on boot (the one global endpoint)
GET  /p/wetell                     shell HTML (the same for every page)
GET  /p/wetell/page.json           {kind, title, defaultTime, filterFields, filterButtons, actions, widgets}   ← new
GET  /p/wetell/api/<id>/query      widget data (Arrow)
GET  /p/wetell/api/<id>/debug      query, EXPLAIN
POST /p/wetell/action/<id>         a Go action (§3.9)                                                        ← new
```

- `page.json` is built **in the same `CollectHandlers` pass** that mounts the widget handlers, so it carries exactly
  the mounted URLs. A compiled dashboard never changes: its JSON is built once at registration.
- **Navigation without reloads:** the shell boots once; a link fetches the target's `page.json` and swaps the content
  (`history.pushState`). Panel state survives navigation; the time range does not (§3.7).
- **Data per widget:** each chart fetches from its own handler URL, in parallel, as today. Explore (later) keeps an
  inline POST. Both sit behind `ctx.query()` (§3.6).
- **Markdown** stays rendered by goldmark on the server and travels as HTML inside `page.json`.

### 3.3 Type-safe contract: `dashica-gen` emits TS too

Go is the source of truth. `dashica-gen` additionally emits TS types: a discriminated union `Widget = {type:
'timeBar', props: TimeBarProps} | …` plus the DTOs (`page.json`, `workbench.json`, actions). Go tests write golden
JSON fixtures, TS tests read them, so drift fails a test on both sides.

### 3.4 Workbench regions

```
┌─ Dashica › Wetell ──── [⌘K search] ── [Last 1h ▾][⟳ 30s][log] ┐   title bar
├─ filters: [Status = 500 ×] [Host = a ×]  [Only errors][Bots]  ✎ SQL ┤   filter bar
│▐menu▌ content (scrolls)                         │▐inspector▌│   left · content · right
├────┴─ bottom panel: Debug │ Details ────────────────┴──────────┤   bottom panel
└─ status: 12 queries · 2 loading · 1 failed · 340 ms ──────────┘   status bar
```

| Region | Holds |
|---|---|
| Title bar | breadcrumb, search everywhere, time range, refresh, log scale; always visible |
| Filter bar | active filters as removable chips, the page's filter buttons as toggles, "edit SQL" |
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

| Host | Offers |
|---|---|
| `commands` | `registerCommand`, `executeCommand`; keys via `contributes.keybindings` |
| `window` | side / bottom panels, title bar and status bar items, `registerMenuItem`, `showContextMenu`, quick pick, messages, search providers |
| `widgets` | `registerWidget` (§3.6) |
| `page` | the shown page (`page.json`), `onDidChangePage` |
| `query` | the state every query depends on (§3.7) |
| state | `globalState` / `workspaceState` instead of direct `localStorage` |

- Client extensions live only in `dashica-src`; the instances (Sandstorm, Solarwatt) customize through Go.
- **Extensions do not depend on each other (for now).** What several need goes into a host (e.g. `query.viewOptions`).
  When that would turn a feature into a host only to share one model (Explore's tabs on `ExploreModel` are the likely
  case), take VS Code's way: `dependsOn: ['explore']`, and what `activate()` returns is its API to the dependents.
- **Plain DOM, no Alpine, no reactivity library.** Models with private state and `onDidChange` events ("commands out,
  events back"); consumers re-render their region coarsely on change. If derived state across many sources gets
  painful, we add a small observable primitive of our own.
- **Styling:** Tailwind + daisyUI stay; the workbench chrome uses daisyUI's tokens (dark mode via daisyUI themes).

### 3.6 Widgets

A widget type is a contribution; its renderer is a function. Charts, tables, markdown, form inputs, the grid and
collapsible groups are extensions.

```ts
widgets.registerWidget('timeBar', {
  render(el, widget: TimeBarWidget, ctx): Disposable,   // widget: generated type (§3.3)
});

ctx.query(): Promise<Table>                // Arrow; tracks loading / ok / error itself (status bar, Debug)
ctx.time / ctx.filters / ctx.params / ctx.viewOptions / ctx.cursor   // models with onDidChange (§3.7)
ctx.onDidRequestRefresh                    // time, filter, param or refresh changed
ctx.renderChild(el, child)                 // grid, collapsible
ctx.addFilter(fieldId, op, value)          // click-to-filter (§3.8)
```

- Function, not class: Plot draws a fresh SVG anyway; a prop change disposes and renders again.
- **Each widget composes itself; the host does not wrap.** Mandatory mechanism sits in `ctx` (`ctx.query()` tracks
  status, so the status bar and Debug work for every widget). The visual chart frame (render once visible, observe
  size, spinner, error, filter status §3.8, menu button) is **one optional helper**, `chartFrame(el, ctx, draw)`;
  charts use it in one line, containers and markdown don't.
- **Form widgets** (`CheckboxGroup`, `TextInput`) are ordinary widget extensions that read and write `query.params`.

### 3.7 Query state and one request format

| Model | Holds | URL | Scope |
|---|---|---|---|
| `time` | time range, auto refresh | `?time=1h` | per page; default declared in Go (`.DefaultTimeRange("7d")`, fallback `24h`); navigation opens the target with its own default (as Grafana) |
| `filters` | structured filters, a time-window filter, free SQL | `?f=…&tw=…&sql=…` | per page |
| `params` | values of form widgets | `?wp=…` | per page |
| `viewOptions` | log scale, … | `?log=1` | global; read by every chart |
| `cursor` | hovered timestamp | — (ephemeral) | synchronized crosshair across all time charts |

Every data handler reads the same query parameters; the server parses them once in `lib/httpserver` into one
`QueryState` (time, filters, params) and drops the legacy `From` / `To`. Params stay what they are today: ClickHouse
parameters (`param_<name>`); the client owns the UI, the server only binds.

**Alerts:** alert widgets only need the time range (the handler uses `filters` only to resolve it), so they read
`time` like every other handler. Dashboard filters do not apply to alert widgets, and alert evaluation
(`lib/alerting`) is not touched. Until the filter step (§5) alerts keep the JSON parameter.

### 3.8 Filters: structured, declared, explicit

**Filter fields are declared, not sent as SQL. The server decides everything; the client only shows and sends ids.**
At `Mount` (Go, once at registration) the page collects every field a chart can be filtered by, with its expression
and id. The client receives only what it shows or sends back: the filter bar's labels (`page.json.filterFields`:
`{id, label}`) and, inside each chart's props, the filter id behind each clickable field. The expressions never leave
the server.

- **Builder queries** (`sql.New`, `sql.Field`): dashica knows each field's `Definition()` and `Alias()`. The filter
  field's expression is the **definition** (`status`, `JSONExtractString(attrs,'host')`), its label the alias. The
  expression references base-table columns, so the filter works in every chart on that table.
- **SQL files** (`sql.FromFile`): only output column names are known. ClickHouse resolves SELECT aliases in WHERE,
  and `{{DASHICA_FILTERS}}` sits in the WHERE of the SELECT that defines them, so `alias = value` works for that
  chart. To filter across charts the author maps it: `.FilterAs("Status", "status_code")`.
- The same id with two different expressions on one page is a registration error (fail fast).

The URL carries ids, ops and values (`?f=status:eq:500&f=host:in:a,b`); **values are bound as ClickHouse parameters**
(`{f0:String}`), never quoted into SQL. So the server builds the WHERE fragment only from Go-declared expressions; no
per-backend quoting code, no injection through filters. Free SQL stays one advanced chip (`?sql=…`). Filter buttons
stay SQL, written in Go, shown as toggles in the filter bar.

**Applicability is explicit, never silent, and decided by the server.** Each widget's query handler knows, from
`Mount`, which filter fields apply to it: builder widgets accept the fields of their base table; SQL-file widgets
accept their own aliases plus what they declare (`.AcceptFilter("host")`); `FromFileWithoutFilters` accepts none. The
handler applies those and reports the rest in the response (`X-Dashica-Ignored-Filters: host`, like today's
`X-Dashica-Resolved-Time-Range`). The client keeps no rule about applicability; the chart frame only shows the
header: no badge when it is empty, otherwise "ignores `host`". The chart still renders, without the filters that do
not apply. A runtime `UNKNOWN_IDENTIFIER` (ClickHouse
code 47, e.g. from the free SQL chip) fails that chart only, with the column named. No query parsing.

**Clicks select; a floating bar offers what to do** (as Zwiebelfisch's `visualEditor/selection` bar above a text
selection). A chart only reports a *selection*; it does not know what can be done with it:

- **Category** (series / fill, bar category, ordinal heatmap row, table cell): a click selects
  `{kind: 'category', fieldId, value}`. Measures (`count()` etc., known from the field's `kind`) are not selectable.
- **Time axis** (time bar, time line, heatmap x): hover moves the synchronized `cursor`; dragging selects
  `{kind: 'time', from, to}`, highlighted on every time chart; clicking one bucket selects that bucket. Plot has no
  brush: the pointer handling lives in a shared time-chart helper.

The selection is one model in the `widgets` host (one selection at a time, Escape clears it). The host shows the
floating bar `widget/selection` next to it; its entries come from `window.registerMenuItem('widget/selection', …)`
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
  contract (§3.3); Go tests for `QueryState` parsing and filter-field collection; Playwright specs for flows (written
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
  readonly window: WindowApi;
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

// window — regions, menus, input, messages
interface WindowApi {
  registerSidePanel(id: string, o: { label: string; icon: string; side: 'left' | 'right'; order?: number;
                                     when?: (p: Page) => boolean }): Panel;     // command workbench.view.<id>
  registerBottomPanel(id: string, o: { label: string; order?: number; when?: (p: Page) => boolean }): Panel;
  registerBarItem(bar: 'title' | 'filter' | 'status', el: HTMLElement,
                  o: { alignment: 'left' | 'right'; priority?: number }): Disposable;

  registerMenuItem<C>(menuId: string, item: MenuItem<C>): Disposable;    // when / enabled / toggled / group / order
  getMenuItems<C>(menuId: string, context?: C): readonly MenuItem<C>[];
  showContextMenu(menuId: string, o: { anchor: Element | {x: number; y: number}; context?: object; args?: unknown[] }): void;
  readonly onDidChangeMenu: Event<string>;
  registerFloatingBar<C>(o: { id: string; order?: number;
                              anchor: (context: C) => DOMRect | null }): Disposable;   // entries via registerMenuItem(id, …)

  showQuickPick<T>(items: T[] | Promise<T[]>, o?: QuickPickOptions): Promise<T | undefined>;
  createQuickPick<T>(): QuickPick<T>;
  showInputBox(o?: InputBoxOptions): Promise<string | undefined>;
  registerSearchProvider(p: SearchProvider): Disposable;               // search everywhere groups
  showInformationMessage / showWarningMessage / showErrorMessage(message: string, ...items): Promise<…>;
}

interface Panel extends Disposable {
  readonly body: HTMLElement; readonly visible: boolean;
  show(): void; hide(): void; readonly onDidChangeVisibility: Event<void>;
}

// page — what the content area shows
interface PageApi {
  readonly workbench: WorkbenchJson;        // from /workbench.json (generated type)
  readonly current: PageJson;               // from <url>/page.json (generated type)
  readonly onDidChangePage: Event<PageJson>;
  navigate(url: string): Promise<void>;     // fetch page.json, pushState, swap content
}

// query — the state every query depends on (§3.7)
interface QueryApi {
  readonly time: TimeModel;                 // range, auto refresh; per page, URL-synced
  readonly filters: FilterModel;            // {fieldId, op, value}[] + time window + free SQL; URL-synced
  readonly params: ParamsModel;             // form widget values; URL-synced
  readonly viewOptions: ViewOptionsModel;   // log scale, …
  readonly cursor: CursorModel;             // hovered timestamp, synchronized across time charts
  refresh(): void;
  readonly onDidRequestRefresh: Event<void>;
}

// widgets — renderers per widget type (§3.6)
interface WidgetsApi {
  registerWidget<T extends WidgetNode>(type: T['type'], r: { render(el: HTMLElement, w: T, ctx: WidgetContext): Disposable }): Disposable;
  readonly statuses: ReadonlyMap<string, WidgetStatus>;   // for the status bar
  readonly onDidChangeStatus: Event<void>;
}
```

Menu ids: `page/title` (page actions), `widget/context` (a chart's menu: debug), `widget/selection` (the floating bar
on a chart selection: zoom, filter, show rows, actions), `table/row` (a row's menu),
`dashboards/entry` (a menu entry: favorite).

Folders as in Zwiebelfisch: `frontend/core/<name>/` (primitives), `frontend/hosts/<name>/` (contribution points),
`frontend/extensions/<name>/` (one folder per built-in extension); `frontend/workbench/` puts hosts and extensions
together (`createWorkbench`). Tests sit next to the code (`<name>.test.ts`).

Built-in extensions:

| Extension | Contributes |
|---|---|
| `dashboards` | left panel "Dashboards" (groups, favorites, filter box) |
| `search-everywhere` | the palette (⌘K / Shift Shift): pages, commands, favorites |
| `time-range` | title bar: presets, custom range, refresh; `widget/selection` "Zoom" |
| `auto-refresh` | title bar: auto refresh interval |
| `log-scale` | title bar toggle; the value lives in `query.viewOptions` |
| `theme` | light / dark toggle |
| `filters` | filter bar: chips, filter buttons, SQL chip; `widget/selection` "Filter by …" / "Exclude …" / "Filter to window" |
| `query-status` | status bar: queries, loading, failed, timings |
| `debug` | bottom panel "Debug" (query, EXPLAIN); `widget/context` "Debug" |
| `row-details` | `table/row` "Details" and `widget/selection` "Show rows" → bottom panel |
| `page-actions` | Go actions from `page.json` → commands + menu items |
| one per widget type: `time-bar`, `time-line`, `bar-vertical`, `bar-horizontal`, `heatmap`, `stats`, `table`, `markdown`, `checkbox-group`, `text-input`, `grid`, `collapsible`, `alerts`, … | `registerWidget` for its type, its CSS, its own menu items |

Favorites stay inside `dashboards` (separating them would need a contribution point inside the Dashboards panel).

### 3.12 Sketch: Go changes

```go
// lib/dashboard/widget — one method instead of BuildComponents + CollectHandlers (§3.13)
type WidgetDefinition interface {
	// Mount registers the widget's handlers below `handlers` (already nested at "<page>/api/<id>")
	// and returns the node that describes it in page.json.
	Mount(ctx *rendering.DashboardContext, handlers handler_collector.HandlerCollector) (Node, error)
}

// the one-liner for the common case: /query + /debug for a SQL query, filter fields collected
func MountQuery(ctx *rendering.DashboardContext, h handler_collector.HandlerCollector,
	typ string, props any, query sql.SqlQueryable) (Node, error)

type Node struct {
	Type     string          `json:"type"`
	Props    json.RawMessage `json:"props"`              // the generated serializer (dashica-gen)
	DataURL  string          `json:"dataUrl,omitempty"`  // "<page>/api/<id>": /query, /debug below it
	Children map[string]Node `json:"children,omitempty"` // grid areas by name; collapsible: "0", "1", …
}

// lib/dashboard — the Builder serves the shell, page.json and actions
func (d *Builder) CollectHandlers(ctx *rendering.DashboardContext, h handler_collector.HandlerCollector) error {
	nodes, err := d.widgets.Mount(ctx, h.Nested("/api"))       // mounts /api/<id>/query + /debug, collects filter fields
	page := PageJson{Kind: "dashboard", Title: d.title, DefaultTime: d.defaultTime, FilterFields: ctx.FilterFields(),
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
| `dashica.go` | `GET /workbench.json` (menu groups); menu data stays as today (`RegisterDashboardGroup`) |
| `lib/dashboard` | `Builder.CollectHandlers` as above; `.DefaultTimeRange(...)`, `.Action(...)` |
| `lib/dashboard/widget` | `BuildComponents` + `CollectHandlers` → `Mount` (§3.13), `RegisterQueryHandlers` → `MountQuery`; ids assigned by the framework; markdown puts its goldmark HTML into its props; `.FilterAs` / `.AcceptFilter` |
| `lib/dashboard/rendering` | `DashboardContext` loses `MainMenu` / layout concerns, collects filter fields; `SearchBarOption` becomes `page.json` fields |
| `lib/httpserver` | `QueryState` (time, `f`, `tw`, `sql`, `wp`) parsed once; filters → one WHERE fragment of declared expressions with bound values into `{{DASHICA_FILTERS}}` / `Where` |
| `cmd/dashica-gen` | additionally emits `zz_generated.dashica.ts` (widget union, DTOs) and golden JSON fixtures |
| deleted | `lib/components/**` (templ), Alpine, dockview, `lib/explore` + `frontend/explore` (rebuilt later, §6) |

### 3.13 Why `Mount`, one method

Today every widget walks the tree twice, `BuildComponents` (HTML) and `CollectHandlers` (HTTP), and both passes must
agree on the widget id: whichever runs first calls `ctx.NextWidgetId()` and stores it in the widget (`b.id = …`),
mutating an otherwise immutable builder. Order and mutation are the coupling.

| Option | For | Against |
|---|---|---|
| **`Mount` (recommended)**: one pass, register handlers + return node | URL and node agree by construction; the id is assigned once by the framework (the collector arrives nested at `api/<id>`), so widgets stop calling `NextWidgetId` and stop mutating themselves; custom handlers stay possible | "describe" and "serve" in one method; describing alone (Explore later) needs a capturing collector, which `lib/explore/preview.go` already has |
| Two methods, `Describe` + `CollectHandlers` | describe without HTTP | the two-pass id coupling stays, only with JSON instead of templ |
| Widgets declare only a query; the framework mounts all handlers | widgets never touch HTTP | does not fit `AlertOverview` / `AlertDetail` (alert storage client), `SpeedscopeLink` (serves a viewer FS): they would need an escape hatch, i.e. `Mount` again |

`Mount` keeps HTTP where it is today (widgets already own their handlers), so it is a rename plus the merge of two
passes, not a new abstraction. Query widgets (time bar, bars, heatmaps, stats, table: nine today calling
`RegisterQueryHandlers`) become one `MountQuery(...)` line; the three special widgets keep their hand-written
handlers.

Containers (grid, collapsible) need each child's own `dataUrl` in `page.json`; the generated serializer nests plain
widget envelopes without URLs, so the two containers implement `Mount` **by hand** (~20 lines each). The generator
stays leaf-only.

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
| Parsing queries (SQL AST) | not needed with declared filter fields; ClickHouse's JSON AST (`clickhouse_json` dialect) is unverified as released and would tie us to ClickHouse |
| Drop non-applicable filters silently / fail the chart | silent is misleading; failing hides useful data. Declared applicability + badge instead (§3.8) |
| Time range global across pages | Grafana-style per-page default is what dashboards expect; links can still carry `?time=` |
| Tabs inside the app | browser tabs do that |

## 5. Migration and risks

Replace in place on `feature/workbench`; merge to `main` at the end. Every step leaves the dashboards working (check
both instances with `mise run up`).

**Working mode:** the agent may commit (this overrides "no commits" in `dashica-src/CLAUDE.md` for this branch), but
**stops after every commit and waits for the maintainer's review** before the next one. Commits stay small (one step,
or a part of one), so deviations from this concept, problems and naming issues are caught as early as possible. A
deviation found while implementing is raised before committing, not decided silently; agreed changes go into this
document in the same commit.

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
| 4 | Menus + palette: `registerMenuItem` / `showContextMenu`; search everywhere replaces `sidebarSearch` | dashboards |
| 5a | Contract: `page.json`, `workbench.json`, `dashica-gen` TS + golden fixtures; served next to the old pages | dashboards; nothing visible changes |
| 5b | Client rendering: widget host, one extension per widget type (wrapping the existing `frontend/chart/*`), client-side navigation, per-page default time; templ chrome and Alpine removed | dashboards, now client-rendered |
| 6 | `QueryState` + structured filters (§3.8), alerts on `time` | filters as chips, click-to-filter |
| 7+ | each planned when we get there: time selection + synchronized cursor, Go actions, status bar query states, row details | |

| Risk | Mitigation |
|---|---|
| Step 5b is one big switch | 5a lands the contract first with golden tests; renderers wrap existing chart code; Playwright flows before merge |
| Explore unavailable from step 3 until rebuilt | accepted: Explore is experimental; rebuilt after the merge (§6) |
| Long-lived branch drifts from `main` (new dashboards in the outer repo) | dashboards are Go only and keep their builder API; rebase regularly |
| Bound filter values typed `String` against numeric columns | verify ClickHouse's conversion in step 6; else carry the type in the filter field |
| SELECT aliases in WHERE are ClickHouse-specific | only for SQL files, which are ClickHouse SQL anyway |
| Bookmarked inner URLs (debug links) break | accepted; entry-point URLs stay |
| Playwright cannot run in the sandbox | specs written by the agent, run by the maintainer |

## 6. Later (out of scope, but the design must not block it)

- **Explore rebuilt** as extensions on `ExploreModel`: widget tree left, inspector right, Data / Go / JSON bottom, while
  `page.kind === 'explore'`. "Open in Explore" becomes a built-in action: `?source=/p/wetell&widget=api/3`, Explore
  reads that widget from the source's `page.json` (no server state, no URL length issue). Persistence: localStorage +
  share link as today.
- **Drill-down: start at a chart, go ad hoc from there.** Two kinds, as Superset names them:
  - *Drill to detail:* a click on a bar / cell opens the bottom panel with the raw rows behind it: the chart's base
    table and WHERE, the page's filters and time, plus the clicked value (`SELECT * … LIMIT n`). Needs the base table,
    which builder queries know; SQL files only if they declare it (§7, question 2).
  - *Drill by / ad hoc:* "Open in Explore" from a chart or dashboard carries the chart *and* the current `QueryState`
    (time, filters, params), so you narrow further, regroup by another field or add charts from there. Builds on the
    Explore rebuild below.

  What the design already gives: declared filter fields (§3.8), one `QueryState` that travels in the URL, and
  `widget/context` / `table/row` menus as the entry points.
- **Permissions per dashboard**, with or without filtering. A middleware on a page's subtree; `/workbench.json` filters
  the menu per user. What the design already gives: structured filters carry only ids and bound values, so they cannot
  change a query; the free SQL chip is the only client-sent SQL, in one parameter (`sql`), parsed in one place, so it
  can be limited to an "advanced" role. Real protection for free SQL must sit in ClickHouse (a readonly user per role,
  grants, row policies, query limits), not in string checks.
- **MCP server with built-in anonymization**: sensitive data must never reach the cloud provider. What the design
  already gives: dashboards are machine-readable (`page.json`), and every query goes through one path (`QueryState` →
  handler), the single place where an anonymization step on results would sit.
- Tabs inside the app; client extensions from the instances (outer repo); other database backends; query
  understanding (AST).

## 7. Open questions

1. **Time selection:** does "Filter to window" need its own chip, or is it a second, narrower time range?
2. **Filter fields of SQL files:** are `.FilterAs` / `.AcceptFilter` the right granularity, or should a SQL file declare
   its base table once (`sql.FromFile(path, sql.Table("logs"))`) and accept that table's fields like builder queries?
3. **Alerts and filters:** should dashboard filters ever apply to alert widgets (e.g. only alerts of host `a`)? For
   now no.
4. **Drill-down:** is "drill to detail" (raw rows in the bottom panel) wanted early, before the Explore rebuild?
   What does ad hoc narrowing need beyond filters + Explore (e.g. regrouping a chart in place)?
5. **Permission model:** roles per dashboard subtree; who may use free SQL; how roles map to ClickHouse users.
6. **Anonymization:** declared per column in Go, or in ClickHouse; reversible (pseudonyms) or not.
