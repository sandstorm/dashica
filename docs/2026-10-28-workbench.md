# Workbench — application shell and extensions (technical concept)

Status: concept agreed 2026-10-28; steps 1–5b done (2026-10-30), next step 6; tabs decided 2026-10-31 and done (§3.4.1, step 7a ✅, not yet run in a browser); the batch D1–D15 decided 2026-10-31, planned as steps 8a–8m (§3.14); D16–D18 and D12 as steps 9a–9d (§3.15), 9a–9c done; D19 (records by command) done as 9e; D20 (the click's filter UI by command) done as 9f; D21 (a pill's key read by the filters extension) done as 9g; D22 (`ChartFrame` and the shared helpers into extension libraries) done as 9h; D23 (full-height left side, the global "…" in the rail, no Dashica icon) done as 9i; D24 (the query state registered by key, per extension) done as 9j; D25 (pill ops by the field's type) done as 9k; D29 (a readable, short pill key) done as 9q; D12 (the SQL editor, also for the SQL condition) done as 9d and 9aa. Branch `feature/workbench` in `dashica-src`; merges to
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
GET  /                            the start page (§3.4.3): shell HTML; its page.json at /page.json, {kind: "home"}
GET  /workbench.json               menu groups, each page with its outline (below; the Explore URL with its rebuild); fetched once on boot (the one global endpoint)
GET  /p/shop                       shell HTML (the same for every page)
GET  /p/shop/page.json             {kind, title, defaultTime, filterBar, filterButtons, widgets}; actions with step 7+
GET  /p/shop/button?i=<n>&value=…  the signed pill of the page's filter button <n> for a value (§3.15, step 9b)
GET  /p/shop/api/<id>/query        widget data (Arrow), what the chart did in X-Dashica-Diagnostics (§3.8)
GET  /p/shop/api/<id>/debug        query, EXPLAIN
POST /p/shop/action/<id>           a Go action (§3.9)                                                        ← new
```

- `page.json` is built **in the same `CollectHandlers` pass** that mounts the widget handlers, so it carries exactly
  the mounted URLs. A compiled dashboard never changes: its JSON is built once at registration.
- **Navigation without reloads:** the shell boots once; a link fetches the target's `page.json` and swaps the active
  tab's content (`history.pushState`, §3.4.1). Panel state survives navigation; the time range does not (§3.7).
- **Data per widget:** each chart fetches from its own handler URL, in parallel, as today. Explore (later) keeps an
  inline POST. Both sit behind `ctx.runQuery()` (§3.6).
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
┌──┬─────────────────┬───────────────────────────────────────────────┬───────────┐
│… │ DASHBOARDS   …  │ [Shop ×] [Explore ×] [+] ─ [⛛][Last 1h ▾][⟳]  │▐inspector▌│   top bar, over the content only (8d, 9i)
│🔍│ favorites …     │ filters: [Status = 500 ×] [Only errors] ✎ SQL │▐         ▌│   filter bar (above the content)
│▦ │                 │ content (scrolls)                             │▐         ▌│   rail · panel · content · right
│🐞│                 │                                               │▐         ▌│   (the sides full height, 9i)
└─ Requests · 1,234 rows · 87 ms · ignores host · 2 records selected ───────────┘   status bar: the active widget, Details' records
```

| Region | Holds |
|---|---|
| Top bar | one row over the content only (between the sides, step 9i), always visible: the tabs (a tab per open page, the active one selected, × to close, §3.4.1) and "+" (the start page in a new tab), then the time range and refresh (the filter funnel went in step 9o, D26) (`ui.registerBarItem('top', …)`; `left` items before the tabs, `center` and `right` ones after them); while a popped-out view's tab is shown only the tabs and "+" (step 9y, §3.4.6) |
| Filter bar | above the content, between the side panels, only while it has something to show and never for a popped-out view's tab (step 9y, §3.4.6): one list of chips, structured (`status = 500`) and SQL (`SQL: duration > 2000`), each removable; a field's pill editable when a chart of the page makes it again (its operator and value, step 9c), a SQL chip while `filters.sqlEnabled` is on (step 9a), the others (another page's pill, a button's pill outside its page) only removable; the page's filter buttons as toggles in place, pressed while their signed pill is set, without a chip of their own (steps 8f, 9b); "Add filter" after the chips while a chart filters a table (step 8m; since 9p reads one, its columns and computed fields, §3.15 D27) or `filters.sqlEnabled` is on, its last entry "SQL condition…" under "Advanced" adding a SQL chip (step 9o, §3.15 D26; the funnel button in the top bar of step 7b is gone) |
| Rails | from the window's top to the status bar, as their panels (step 9i): at the left rail's start the global menu's "…" (menu `workbench/global`, `UiHost.railStart`, hidden while empty; with Explore off it holds "Explore" greyed, 8g; with Explore on "Explore" and "Start from chart…", 8i); a button per side panel, and command buttons (`ui.registerRailButton`): search everywhere first after the "…"; each button's tooltip is its name and its command's key ("Search everywhere (⌘K)") |
| Left side panel | "Dashboards" (favorites, then the menu groups, each a view, §3.4.2); "Debug" (the active widget's query, stats, EXPLAIN, result, as views, §3.4.4); "Details" (the ticked rows a table gave it by command, a view each, §3.4.5); Debug and Details pop out into a tab (§3.4.6); later Explore's widget tree |
| Right side panel | later Explore's inspector |
| Status bar | the active widget's rows, query time, error, ignored filters (§3.4.4); "N records selected" (§3.4.5) |

- **Panel headers (step 8d):** the shown panel sits under a header row: its name in caps ("DEBUG", CSS
  `text-transform`, so screen readers read "Debug"; the panel's body is labelled by it) and "…", which shows the menu
  `panel/<id>` (context and arguments none). Every such menu has "Hide" (command `workbench.view.<id>.hide`), so "…"
  is never empty *(proposed)*; Debug's and Details' have "Pop out" too (step 8l, §3.4.6).
- **"+"** opens the start page "/" in a new tab, or shows the tab that has it (`navigate('/', { newTab: true })`)
  *(proposed)*. There is no Dashica icon or home button (step 9i): "+" and the dashboards (Dashboards panel, search
  everywhere) reach the start page.

- The layout is ported from Zwiebelfisch (`WindowLayout`, `SideBar`: one CSS grid, rails with a button per panel,
  resizable, state remembered, left panel overlays on narrow screens). The bottom panel is gone with step 7e (Debug
  moved to the left side, it had no other user); a table's selected rows show in the left side panel "Details" (§3.4.5).
- **Tabs** (decided 2026-10-31, reversing "one page at a time"): a tab bar in the top row (step 8d); each tab shows one
  page with its own URL and query state, the address bar the active tab's (§3.4.1).
- A **page** is what a tab shows: `page.kind` = `dashboard` | `explore` | `home` (the start page, §3.4.3) | `docs`.

#### 3.4.1 Tabs (decided 2026-10-31, reversing one page at a time)

**Decided by the maintainer:** a tab bar above the content, ported from Zwiebelfisch's editor tabs; any page can be
a tab (a dashboard, a chart's Explore view, docs); each tab keeps its own URL (path, `?time`, `?range`, `?f`, `?sql`,
`?wp`, hash) and query state, and the address bar shows the active tab's, so links and reload work as before; a
background tab keeps its DOM (scroll position, Perspective's layout), its charts do not query and auto refresh pauses,
and it catches up when shown; the Explore view opens as a tab, and `showOverContent` goes. Everything marked
*(proposed)* below was decided by the agent and waits for review.

```
┌ […][▮] [Shop ×] [Explore: 500 per instance ×] [Checkout ×] [+] ── [Last 1h ▾][⟳ 30s] ┐   top bar: the tabs, the active tab's time and refresh
│▐    ▌ filters: [Status = 500 ×]                               │   filter bar: the active tab's filters
│▐    ▌ content: the active tab; the others hidden, rendered    │   content
```

**A tab is a value** `{ id, url, title }`: `url` is path, query and hash (`/p/shop?time=1h&f=host:eq:a#w=3`), so its
query state *is* its URL's query and nothing else is kept per tab; `title` is what the tab bar shows. For each open
tab the `page` host keeps what that value stands for: a `QueryHost` with the state of the tab's URL, its `page.json`
and its rendered page, in its own element of the content region (`hidden` while in the background). The open tabs
are a list of these values plus the active id; opening, closing, the limit and the tab shown after a close are pure
functions on it (`frontend/hosts/page/tabs.ts`), tested without DOM *(proposed)*.

| | One per window | One per tab |
|---|---|---|
| commands, `ui` (regions, menus, quick input), widget and page renderers, extensions | ✓ | |
| query state (`QueryHost`) | | ✓, from the tab's URL |
| `page.json`, the rendered page | | ✓ |
| the selection (`widgets.selection`) | ✓; switching tabs clears it *(proposed)* | |
| side panels (Dashboards, Debug) | ✓; Debug follows the active tab's active widget (§3.4.4) | |
| the active widget (`widgets.active`) | | ✓, the widget pressed or focused in last (§3.4.4) |

- **`QueryHost` per tab, without `location`.** It takes its state from a given query string
  (`load({ search, page })`, since 9j; the page for the defaults it declares) and reports each change instead of
  writing the address bar:
  `onDidChangeSearch: Event<string>` (debounced as today; the hash is the tab's, not the query host's). Reading and
  writing the query string become pure functions, `parseSearch(search, defaultTime)` and
  `formatSearch(state, defaultTime, search)` *(proposed)*. The `page` host puts the new search into the tab's `url`,
  and for the active tab into the address bar.
- **Extensions see the active tab.** `ExtensionContext.query` is `activeQuery(page)`
  (`frontend/hosts/query/active-query.ts`): a `QueryApi` that forwards every read and call to the active tab's
  `QueryHost` and fires each model's `onDidChange` when the active tab's fires and once when another tab becomes
  active; `onDidRequestRefresh` only when the active tab's fires (a tab shown catches up itself, below). So the time
  picker and refresh button in the top bar, the filter bar, the table's filter commands and "Filter by …" keep their
  code *(proposed; the alternative, each of them re-subscribing to `page.activeTab.query` on a tab change, repeats
  that in four extensions)*.
- **Widgets see their own tab.** A page renderer gets its tab's `PageContext` and renders each widget with
  `widgets.render(el, widget, context.query)`, so `WidgetContext.query` is that tab's `QueryHost`: a chart in a
  background tab never sees the active tab's changes.
- **`page.current`, `onDidChangePage`** are the active tab's page: it fires with `page.current` when the active tab
  shows another page, when its page could not be shown (`undefined`), and on every switch to another tab, also to one
  without a page (`undefined` while it loads or after it failed), so the filter bar and the dashboards panel never keep
  the tab before's (chosen over the extensions also listening to `onDidChangeTabs`: one event, one listener each). `page.tabs`, `page.activeTab`, `onDidChangeTabs` are
  for the tab bar and whoever names the page shown (the dashboards panel's highlight, search everywhere's "current page
  first", "Copy link to chart" read `page.activeTab.url` instead of `location`).

```ts
// page — the open tabs and the page each shows
interface PageApi {
  readonly workbench: WorkbenchJson;
  readonly tabs: readonly Tab[];                 // in the tab bar's order
  readonly activeTab: Tab;
  readonly onDidChangeTabs: Event<void>;         // opened, closed, activated, retitled, its URL changed
  readonly current: PageJson | undefined;        // the active tab's page; undefined while it loads or failed
  readonly onDidChangePage: Event<PageJson | undefined>;   // with `current`, on every switch too
  /** In the active tab as today; `newTab`: in a new tab after the active one, shown; one with the same URL open is shown instead. */
  navigate(url: string, options?: { newTab?: boolean }): Promise<void>;
  showTab(id: string): void;                     // the tab bar, the tab commands
  closeTab(id: string): void;
  popOut(view: PoppedView): Promise<void>;       // a view in a new tab, in memory only (step 8l, §3.4.6)
  registerPageRenderer(kind: string, renderer: PageRenderer): Disposable;
}
interface Tab { readonly id: string; readonly url: string; readonly title: string }
interface PoppedView { readonly title: string; render(el: HTMLElement): Disposable }

type PageRenderer = (el: HTMLElement, page: PageJson, context: PageContext) => { dispose(): unknown; readonly title?: string };
interface PageContext {
  readonly query: QueryApi;                      // the tab's
  readonly hash: string;                         // the tab's hash (`#w=3`, `#explore=3`)
  readonly onDidChangeHash: Event<void>;         // only this tab's hash changed
  close(): void;                                 // closes the tab (the Explore view's "Close")
}
```

`dashboard-page` reveals `#w=` from `context.hash` and `onDidChangeHash` instead of the window's `hashchange`, so a
background tab never scrolls.

**Address bar and history.**

- The address bar shows the active tab's URL, `document.title` its title.
- Every history entry names its tab: `history.state = { tab: id }`. Inside a tab as today: `navigate`, a change of
  the query state and a jump to a hash push an entry. **Switching tabs replaces the entry** (`replaceState` with the
  shown tab's URL): a switch is no step of Back, and Back goes to the entry before the one replaced *(proposed)*. **Opening a tab pushes one**, so Back after "Open in
  Explore view" shows the dashboard's tab again, as Back closed the overlay before; the Explore tab stays open.
- `popstate`: the entry's tab is shown (opened again with that id if it was closed *(proposed)*) and takes the entry's
  URL as today: only its hash changed → `onDidChangeHash`; its query → `query.load`; else its page loads. An entry
  without a tab (a hash link the browser followed, a URL typed into the address bar, the first load) belongs to the
  active tab and gets its id by `replaceState`.
- **Reload** restores the open tabs *(proposed: the least that survives a reload)*: the list `{ id, url, title }` and
  the active id are in sessionStorage (`dashica:workbench:tabs`, beside the layout's state). On start they come back in
  their order; the address bar's URL goes into the tab its entry names, else into the stored active tab, which shows.
  The others stay unloaded until first shown: each gets its `QueryHost` and element, but no `page.json` is fetched and
  nothing queries until the tab is first shown; Back or Forward to an entry of such a tab loads that entry's URL once. Scroll positions
  are lost; Perspective's layout comes back from its `globalState` as today. A duplicated browser tab starts with a
  copy of the tabs (the browser copies sessionStorage).

**Opening and closing.**

- **Opens a tab:** "Open in Explore view" (always a new tab); "Pop out" of Debug and Details, "Open Speedscope"
  (`popOut`, §3.4.6); "Open in new tab" in a dashboard entry's menu
  (`dashboards/entry`); search everywhere with Cmd / Ctrl+Enter (`SearchItem.accept({ newTab })`) *(proposed)*. A plain
  click on a link navigates the active tab as today; Cmd / Ctrl / Shift / middle click stays the browser's (a new
  browser tab), since every tab's URL is a real link *(proposed)*.
- **Closes a tab:** its ×, a middle click on it, the command `workbench.tabs.close`. The tab shown before it becomes
  active. The last tab has no ×: there is always one *(proposed)*. Closing disposes its page and its `QueryHost`;
  `ChartFrame` aborts its running queries on dispose.
- **Limit:** 10 tabs; opening an eleventh closes the one shown least recently, since no tab holds unsaved work
  *(proposed)*.
- **Title:** the renderer's `title` when it returns one (`Explore: Absolute HTTP 500 Errors per Instance`), else
  `page.title`, else the URL's path while it loads or failed.
- The tab bar shows with a single tab too, so nothing moves when the second opens *(proposed)*. Commands
  `workbench.tabs.close`, `workbench.tabs.next`, `workbench.tabs.previous` are in the palette without keys: Cmd / Ctrl+W
  and Ctrl+Tab are the browser's *(proposed)*.

**A background tab** is `hidden`; its DOM stays. Its charts query nothing: its `QueryHost` fires
`onDidRequestRefresh` on a change of its own state, which only the active tab's controls make, and on auto refresh.
the `refresh` extension refreshes only the active tab (since 9j, §3.15 D24; before, `QueryHost.setShown`): a tab
shown again refreshes once when its interval passed while it was in the background, else when it passes, the same
path as `visibilitychange`. A chart not yet in view queries once it is, as today (`ChartFrame`'s IntersectionObserver; a
hidden element never intersects). A relative range without auto refresh is not refreshed when the tab is shown, as
in a hidden browser tab *(proposed)*.

**What replaces `showOverContent`:** `page.navigate(url, { newTab: true })` and a page kind named in the hash.
`UiApi.showOverContent` and the window layout's over-content element (added on `spike/perspective`) go.

**The Explore view is a tab without a server route.** A tab whose hash has a key that is a registered page kind
(`#explore=3`) is rendered by that kind's renderer, with the `page.json` of the URL's path; otherwise by `page.kind`
*(proposed)*. A change of only the hash that names another kind renders the tab anew. The Explore tab's URL is the
source tab's URL with `#explore=<id>` instead of its hash (`/p/shop?time=1h&f=host:eq:a#explore=3`): the same shell
and `page.json`, so a reload and a shared link reopen it; it starts with a copy of the source tab's query state, and
its filters change only its own rows. The tab API names no kind: without the `explore-view` extension, `#explore=3`
names nothing and the dashboard renders.

| File (frontend) | Change |
|---|---|
| `hosts/page/tabs.ts` | new: the `Tab` value and the pure functions on the list (open, close, limit, the tab shown after a close, restore) |
| `hosts/page/page-impl.ts` | the open tabs: per tab `QueryHost`, element, `page.json`, rendered page; `navigate(url, { newTab })`, `closeTab`; history `{ tab }`, `popstate`, hash changes per tab; the renderer by the hash's kind; sessionStorage |
| `hosts/query/query-impl.ts` | state from a given search, `onDidChangeSearch`; since 9j only the keys of the extensions, since 9w the keys used (`QueryKeys`, §3.7) |
| `hosts/query/active-query.ts` | new: `activeQuery`, the active tab's `QueryApi` for extensions |
| `hosts/ui/layout/tab-bar.ts` | new: `TabBar`, ported from Zwiebelfisch's `EditorTabs` (`role=tablist`, a button per tab with `aria-selected` and its id in `data-`, one click listener on the list, `update(tabs, active)`), plus a title, × and middle click (`onDidChoose`, `onDidClose`) |
| `hosts/ui/layout/window-layout.ts` | the tab bar region above the filter bar; the over-content element gone |
| `hosts/widgets` | `render(el, widget, state)` |
| `workbench/workbench.ts` | no window-wide `QueryHost`; the `page` host makes one per tab and draws into the `TabBar` |
| `extensions/dashboard-page`, `dashboards`, `search-everywhere`, `chart-link` | `context.hash`; "Open in new tab"; Cmd / Ctrl+Enter; `page.activeTab.url` instead of `location` |

#### 3.4.2 Views in a panel (step 7c)

A panel's body can hold several **views** one below the other, each a header (chevron, title, while closed a muted
description such as its count, then optional action buttons) above a body the header closes and opens. Views scroll
with the panel; a header stays at the top while its body scrolls past (`position: sticky`); no sashes between views
*(proposed)*. First users: the Dashboards panel ("Favorites", then a view per menu group, replacing the group headings,
the rule between groups and the guide line); Debug's sections (step 7e, §3.4.4).

- **API: a pure helper, no registry** *(proposed)*: `createView({ id, title, description?, actions?, collapsed?,
  state, body })` (exported from `hosts/ui/ui.ts`, in `hosts/ui/views/view.ts`) returns the view's element; its owner
  puts it where it wants and draws it anew when its content changes. No `panel.registerView`: the owner already draws
  its panel's content, and a registry would keep view elements alive beside it.
- **Collapsed state:** kept in the owner's memento (`state`) under `views.<id>.collapsed`, read whenever the view is
  drawn; Dashboards keeps it in `globalState`, across visits *(proposed)*. `collapsed` is the state before the viewer
  chose one. Without `state` the view keeps it in its element only, and a view drawn anew starts as `collapsed` says
  (Details' record views) *(proposed)*.
- **Keyboard:** the title is a `<button aria-expanded aria-controls>` inside an `<h2>` (Enter / Space toggle; the body's
  id from a module counter, `d-view-<n>`); ArrowLeft closes, ArrowRight opens *(proposed)*. The actions sit beside the
  heading, never inside the button.
- **Favorites in their order:** the stored `globalState` `favorites` is the order shown; a new favorite goes last. A
  favorite moves by its grip (in front of it, shown on hover): pointer events (mouse, pen, touch), not HTML5 drag and
  drop, so the row moves in the list as the pointer passes the middle of another and jsdom can test it *(proposed)*;
  releasing stores the order, Escape or `pointercancel` puts it back. From the keyboard: Alt+ArrowUp / Alt+ArrowDown on
  any part of a favorite, the focus staying on that part; the link announces the keys (`aria-keyshortcuts`)
  *(proposed)*.
- Kept: a favorite names its group, muted after its title; a star toggled keeps its place on screen; the page shown
  tinted. The entries' text lines up with the view's title.

#### 3.4.3 The start page "/" (step 7d, decided 2026-10-31)

"/" is a page of its own, not a dashboard and no redirect (the redirect to `/home` is gone): the viewer's favorites as
tiles (title, its group muted below; in the viewer's order), then every menu group with its dashboards as links; with
no favorites a hint to star one. "+" in the tab bar opens it (step 9i: no Dashica icon any more); its tab is titled "Home".

- **Go:** `dashboard.CollectHome` mounts the shell at exactly `/` (the pattern `/{$}`, so other paths still 404) and
  `/page.json` (`dashboard.HomePage`: `{kind: "home", title: "Home"}`, no widgets, no filter bar), from `newDashicaImpl`
  beside `/workbench.json`. `ListenAndServe` serves the Dashica as it is. The outer repo's `/home` page
  (`src/root_page.go`) and its group "Dashica" are gone.
- **Client:** the renderer of kind `home` is in the `dashboards` extension, which owns the favorites: `homePage(menu,
  favorites)` (`extensions/dashboards/home-page.ts`) is a pure function to an element, drawn anew when the viewer
  toggles or moves a favorite in the panel (an `EventEmitter` inside the extension) *(proposed)*. The tiles are links,
  opened by the page host like any other (Cmd / Ctrl+click: the browser's new tab); no star, menu or drag on the start
  page itself *(proposed)*.
- **The same bars on every page** (D1, step 8a): the time range, refresh and the status bar show on "/" as on any
  other page (a popped-out view's tab is not a page: it has neither the top bar's items nor the filter bar, §3.4.6); Debug's status item says "No active chart" there. Each extension registers its bar item once, with
  `ui.registerBarItem`, for the whole session. (Step 7d.1 took them off "/" with `hasQueries(page)` and
  `registerBarItemWhile`; both are deleted: "no magic, useless abstraction".) The start page's `page.json` is in the
  contract golden file (`export const home`).

#### 3.4.4 The active widget, Debug and the status bar (step 7e, decided 2026-10-31)

As the active editor: the **active widget** is the widget with data the viewer pressed (`pointerdown`) or focused in
(`focusin`) last, anywhere in its element: its title, a mark (whose click still selects, §3.8), its menu button, a table
cell. A quiet accent outline marks it (`d-widget--active`). Each tab has its own; switching tabs shows that tab's.
Escape keeps it; removing the widget (its page rendered anew, its tab closed) ends it.

- **API (`widgets` host; step 8b, §3.14 D2):** as VS Code's `window.activeTextEditor`, `widgets.active: RenderedWidget
  | undefined` refers to the widget itself (`{widget, url(path), lastResult, status, onDidChangeStatus}`, the same
  object as long as it is rendered; its event ends when it is removed; records left it in 9e, §3.4.5), and
  `widgets.onDidChangeActive` fires only when another widget or tab becomes active or the widget is removed. The
  widget's `onDidChangeStatus` fires when its query started, answered or failed. `WidgetStatus` = `idle` | `loading` | `done {rows, ms}` (its `diagnostics` gone in 9ae, §3.15 D38) | `error {message,
  ms}`, set by `ctx.runQuery()` itself, so every widget with data has one; `ms` is the time until the answer in the
  browser *(proposed)*. Only the latest `ctx.runQuery()` sets the status and `lastResult`: an earlier one still answering
  changes neither, so a refresh during a load keeps "querying…"; an aborted latest one puts back the status of the last
  query that answered or failed *(proposed)*. The host keeps each tab's
  active widget under the tab's query state (the `QueryApi` its widgets render with) and is told the active tab by the
  `page` host (`ActiveQuerySource`, as `activeQuery`); no other registry.
- **Innermost widget with data** *(proposed)*: a press inside a chart inside a grid makes the chart active (the closest
  element with `data-data-url`); containers, markdown and form inputs never become active.
- **Debug is a left side panel** (rail button "Debug", a bug icon, after "Dashboards"; one left panel shows at a
  time): the active widget's views (§3.4.2), without its title (its outline tells which widget; since 2026-10-31): Query (the SQL as sent), Decorations (the widget's decorations with their source, badge, tooltip and whether they mute, drawn anew on each `onDidChangeDecorations`; since 9af, §3.15 D38), Stats (ClickHouse's stats and the
  summary of the chart's answer, closed), EXPLAIN plan, Pipeline (graph and steps, closed), Syntax (closed), Result (the
  last result as a table); their collapsed state in the extension's `globalState` *(proposed)*. It asks
  `<dataUrl>/debug` only while it is shown: when shown, when another widget becomes active, and when the active
  widget's query answered or failed (a query state change queries the chart again). It listens to the active widget's
  `onDidChangeStatus` only; while that query runs it keeps what it shows, and
  an aborted query putting back the status it asked for asks nothing *(proposed)*. Without an active widget: "Click a chart to see what it queried." The chart menu's "Debug" opens the
  panel; pressing the menu button made the chart active already, so no `setActive` exists *(proposed)*.
- **Status bar:** one item of the `debug` extension, there on every page: the active widget's "1,234
  rows · 87 ms" (not its title, since 2026-10-31) followed by its decorations' badges ("ignores host = a", "skipped: …";
  since 9af, D38, also after the rows of a skipped chart, "0 rows · 2 ms · skipped: …" *(proposed)*), "querying…" or the first line of its error (at most 80 characters, red;
  the whole message in the tooltip); "No active chart" without one. A click opens Debug *(proposed)*. The status bar so
  always shows, on the start page too (§3.4.3); the page-wide query counts of the sketch (`query-status`) are not
  built.
- **The bottom panel is removed** (`BottomPanel`, `registerBottomPanel`, its CSS and stored layout key): Debug was its
  only user.

#### 3.4.5 Selected records and the Details panel (step 7f, decided 2026-10-31; by command since 9e, D19)

A table's ticked rows (Tabulator's row selection checkboxes, and the one for all in the header) are its **selected
records**. Since 9e (D19, §3.15) they are the table's own: records leave the generic widget, and the table tells
Details of them by command, as VS Code's extensions do. The in-table "N record(s) selected" panel (fixed at the
bottom, full screen, close) is gone. A click on a cell still offers to filter by its value (§3.8, since 8c in the
quick pick "Filter"); the two never mix.

- **API:** none in the `widgets` host: `RenderedWidget` and `WidgetContext` keep what every widget with data has
  (`status`, `onDidChangeStatus`, …); `records`, `onDidChangeRecords` and `selectRecords` are gone (step 9e). The press
  on a checkbox makes the table active, as any press in a widget does (§3.4.4); ticking by keyboard focuses in it.
- **The table:** `drawTable(…, { selectRecords })` draws the checkbox column only with it (so Debug's result table has
  none *(proposed)*), its `rowSelectionChanged` calls it with the ticked rows (in the order ticked *(proposed)*). The
  table's renderer keeps them as local state and runs the command `details.showRecords` with `{ widget, records }`
  (`widget`: its `WidgetNode`, what Details needs for its title and as the records' identity) on each change of them,
  and with no records when a new answer clears them (each draw starts with none: a new answer, also another width or
  color scheme *(proposed)*) or the table is removed, both only when rows were ticked. Without the `details`
  extension the command fails, which goes to the console *(proposed)*.
- **Details is a left side panel** (rail button "Details", a list-checks icon, after "Debug"): it keeps what
  `details.showRecords` gave it last (local state of the extension) and no longer reads `widgets.active`: the widget's
  title, then a view (§3.4.2) per record ("Record 1", …), its fields one below the other as `renderRecordDetails` had
  them (a JSON value pretty-printed, a value of several lines as it is, others as text; built with `htl`, so escaped);
  each view starts open and its collapsed state is not kept: stored by the record's place, closing "Record 1" of one
  table closed "Record 1" of every other table and of the next selection *(proposed)*. Drawn only while shown, anew on
  each call. A call without records clears them only when they are that widget's: another table's cleared ticks (its
  next answer) leave them *(proposed)*. Another active widget or tab leaves them too: they are the table's, not the
  active widget's *(proposed)*. Without records: "Tick rows of a table to see them here." The table's search term is
  no longer highlighted in the details *(proposed)*.
- **Status bar:** a second item, of the `details` extension: "2 records selected", hidden while none (step 8a: it
  stays registered); a click opens Details *(proposed)*.

#### 3.4.6 A view popped out into a tab (step 8l, D14, decided 2026-10-31)

A side panel's view pops out into a tab of its own, bound to what it showed then: the tab no longer follows the active
widget. It is kept in memory only.

- **API (`page` host):** `page.popOut({ title, render(el) })` opens a new tab after the active one and shows it (a new
  history entry, as `navigate(…, { newTab })`). The tab is the active tab's page with `#view=<tab id>`: the page kind
  `view`, which the host renders itself with the view's `render`, the tab titled `title`. It takes the page shown,
  without fetching its `page.json` again *(proposed)*; its time range and filters are the tab's own and change nothing
  the view shows *(proposed)*. Closing the tab disposes what `render` returned and forgets the view.
- **No page bars (step 9y, D33):** while the active tab shows a popped-out view (`PageHost.showsPoppedView`), the top
  bar shows only the tabs and "+", and there is no filter bar: the workbench calls `UiHost.showPageBars(false)` on each
  change of the tabs, which withholds the items of the top and the filter bar (`Bar.withhold`: hidden as if there were
  none, the tab bar stays). Decided once for every popped view (Debug, the Details comparison, Speedscope), not per
  extension; the extensions keep their items registered. *(proposed)* The time range and auto refresh go too, not only
  the filter bar: Debug follows its widget in the page's tab, the Details comparison keeps its records, Speedscope
  its profile of the click, so neither changes anything there; hidden rather than greyed, as nothing in such a tab
  reads them. The status bar stays (its items are the workbench's, not the tab's).
- **In memory only:** the stored tabs (`storedTabs(list, kept)`) leave out the popped tabs, so a reload closes them; a
  `#view=<id>` with no view in memory names no kind, so a link to it (or a reload while it is shown, the address bar
  going into the tab shown last of the others) shows the page *(proposed)*.
- **Debug:** "Pop out" in `panel/debug` (greyed without an active widget; since 9t its command's enablement): a tab "Debug: <title>" with the same views,
  following that widget's status as the panel does (`followDebug`, shared by both), so it asks `/debug` again when the
  widget's query answered *(proposed)*.
- **Details:** "Pop out" in `panel/details` (greyed while Details has no records; since 9t its command's enablement): a tab "Details: <title>" with the
  records kept then side by side (`drawComparison`: a row per field, a column per record, a row whose values
  differ tinted, a missing field empty). It keeps those records: the table clears its ticks on each answer, so
  following them would empty the tab on the next refresh *(proposed)*.
- **Speedscope:** "Open Speedscope" opens a tab "Speedscope" with the viewer in an `<iframe>`, on the profile of the
  page's state at the click; it stays a link, so a click with a modifier key or the middle button opens the viewer in a
  browser tab as before *(proposed)*.

### 3.5 Extensions and UI code

As in Zwiebelfisch: an extension is `{ id, contributes, activate(context) }`; it registers into the hosts' contribution
points, pushes every registration (a `Disposable`) into `context.subscriptions`, and never imports another extension.
Hosts keep only mechanism.

What several extensions need for drawing lives in a library folder `frontend/extensions/<name>-library/`: stateless
helpers, no `Extension`, no state of its own at module level (what it builds may keep the state of the drawn element,
a table's search box). Extensions may import a `-library` folder; hosts never do. `chart-library` holds the chart
frame (`ChartFrame`, §3.6), the column check
(`SchemaAnalyzer`), the time selection of the time charts (`timeBrush`: for now a drag sets the page's time range,
through `DrawOptions.onTimeSelect`, as on the legacy page; step 7 turns it into a selection, §3.8) and the table (`drawTable`: the widget type `table`, the Debug panel). `widget-library` holds `widgetTitle` (a widget's
title, else its type), `time-library` `formatTime` (an end of a custom range, as `customRange` takes it) and, since 9j, the specs of the
query states `time` and `refresh` (§3.7)
(9h, §3.15 D22); `sql-library` the SQL editor (CodeMirror 6, its own bundle loaded on first use), the completion of a
schema and the store of the connections' schemas (`Schemas`), shared by the Explore view, the filters and the Schema
view (9d, §3.15 D12); `filter-library` the contract between the charts, the Explore view and the `filters` extension:
the command `filters.offer` (`OFFER`), its argument types `FilterCandidate`, `PillSource`, `OfferFilters`, and
`offerFiltersOf`, which runs it (9ad, §3.15 D38).

| Host | Offers |
|---|---|
| `commands` | `registerCommand` (with the command's `enablement` / `disabledReason`, 9t), `executeCommand`, `enablement`; keys via `contributes.keybindings` |
| `ui` | side panels, views inside them (`createView`, §3.4.2), top bar, filter bar and status bar items, rail buttons (`registerRailButton`, 8d), `registerMenuItem`, `showContextMenu`, the quick input (`showQuickPick` / `showInputBox` / `createQuickPick`, 8c, §3.14 D3), messages, search providers |
| `widgets` | `registerWidget` (§3.6), the active widget (`active`, `onDidChangeActive`, §3.4.4) and its status, widget decorations (`registerDecorationProvider`, a widget's `decorations` / `onDidChangeDecorations`, as VS Code's file decorations; 9af, §3.15 D38); it knows nothing of filtering: a click to filter is the `filters` extension's command `filters.offer`, its types in `filter-library` (§3.8, 9f, 9ad); the chart frame is `chart-library`'s (9h) |
| `page` | the open tabs and the page each shows (`page.json`), the active one's `onDidChangePage`, `navigate(url, { newTab })` (§3.4.1), `popOut(view)` (§3.4.6) |
| `query` | the state every query depends on (§3.7), one per tab; extensions see the active tab's; it knows no key: typed keys carry their URL format (`queryKey`, `get` / `set` / `onDidChange`, 9w) |
| state | `globalState` / `workspaceState` instead of direct `localStorage` |

- Client extensions live only in `dashica-src`; the instances customize through Go.
- **Extensions do not depend on each other (for now).** What several need goes into a host or a library (e.g. the
  query key `TIME`: defined in `time-library`, shown by `time-range`, set by `ChartFrame`).
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

ctx.runQuery(): Promise<QueryResult>       // Arrow table; tracks loading / ok / error itself (status bar, Debug)
result.headers                             // the answer's headers as they came; the host reads none (9ae, D38): each user
                                           // reads its own through a pure function, diagnosticsOf (filter-library, §3.8),
                                           // columnTypesOf, resolvedTimeRangeOf, bucketSizeOf (chart-library), thresholdsOf (alerts)
ctx.query                                  // the tab's QueryApi: get(TIME), set(TIME, v), onDidChange(TIME, l), requestParams (§3.7)
ctx.query.onDidRequestRefresh              // time, filter, param or refresh changed
ctx.url(path)                              // below the widget's handler, with the query state (Speedscope)
ctx.renderChild(el, child)                 // grid, collapsible
ctx.showMenu(menuId, anchor)               // any menu for this widget (its context); the frame's "More": `widget/context`
ctx.decorations, ctx.onDidChangeDecorations // what providers say about its answer (9af): badges, muted; drawn by ChartFrame
// click to filter: commands.executeCommand('filters.offer', at, candidates, { dataUrl, filterable }) (§3.8, 9f)
```

- Function, not class: Plot draws a fresh SVG anyway; a prop change disposes and renders again.
- **Each widget composes itself; the host does not wrap.** Mandatory mechanism sits in `ctx` (`ctx.runQuery()` tracks
  status, so the status bar and Debug work for every widget). The visual chart frame (render once visible, observe
  size, spinner, error, the widget's decorations as a badge each with its tooltip, the drawing muted while one says
  so (D28; since 9af, D38, without knowing what they mean: the `filters` extension's "ignores host = a" and
  "skipped: …"), nothing drawn for an answer without a table (a 204) *(proposed)*, menu button) is **one optional
  helper**, `new ChartFrame(el, ctx, { draw })` (`chart-library`, since 9h); charts use it in one line, containers and markdown don't.
- **Form widgets** (`CheckboxGroup`, `TextInput`) are ordinary widget extensions that read and write the query key
  `PARAMS` (`widget-library/params-state.ts`, `ctx.query.get(PARAMS)`, since 9w).

### 3.7 Query state and one request format

✅ **Typed keys (D24, step 9j; D36, step 9w, 2026-10-31):** the `query` host is a plain per-tab URL state store that
knows no key of its own. Each part of the state is a typed key that carries its URL format, defined once where the
state belongs: `export const TIME = queryKey<TimeRange>(['time', 'range'], { parse(url, page), format(value, page),
sentToServer })`. Readers and writers import the key and use `query.get(TIME)`, `query.set(TIME, value)`,
`query.onDidChange(TIME, listener)` (to an extension the active tab's, `activeQuery`; to a widget its tab's,
`ctx.query`): typed by the key, no generic argument, no cast, never `undefined`. Nothing is registered: the host knows
a key from its first use, in any tab (`QueryKeys`, shared by the tabs), so it writes and sends it in every tab from
then on; ownership is who defines the key. The host keeps each tab's values (parsed from the tab's query string when
first read, so a key first used after a load reads the URL loaded), writes them into their URL keys a moment after a
change (the other keys kept as they are), fires the change, and `requestParams()` sends each key's server entries in
the order the keys were first used. A key sent to the server (`sentToServer: true`, its `format` entries without a
page; or a function, its own entries: `TIME`, sent also when it is the default) asks the widgets to query again on its
change; one without does not (auto refresh). A `set` the URL would hold alike changes nothing. *(proposed)* The page
shown is given to `parse` / `format` for the defaults it declares (`defaultTime`), in place of a `default` per key;
one key may span several URL keys (`time` + `range`, `f` + `sql` in chip order), so `parse` reads the whole query
string; the first argument of `queryKey` is the URL key or keys, not a separate name; a key the server reads is sent
only once something used it, which every key's owner does on activation or render (`time-range`, `filters`, the form
widgets) *(proposed)*.

| Key | Defined in, used by | Holds | URL | Notes |
|---|---|---|---|---|
| `TIME` | `time-library/time-state.ts`; `time-range`, `ChartFrame` | time range | `?time=1h`, `?time=custom&range=…` | default the page's (`.DefaultTimeRange("168h")`, fallback `24h`); sent also when the default |
| `REFRESH` | `time-library/refresh-state.ts`; `refresh`, `time-range` | auto refresh | `?refresh=30` | not sent |
| `FILTERS` | `filters/chips.ts`; `filters` | one list of chips: pills and SQL chips (step 7b, §3.8); later a time-window filter | `?f=…&sql=…`, each repeatable, in chip order | `addChip` / `replaceChip` / `removeChips` |
| `PARAMS` | `widget-library/params-state.ts`; the form widgets | values of form widgets | `?wp=…` | `withParam` |
| `cursor` | — | hovered timestamp | — (ephemeral) | later: synchronized crosshair across all time charts |

Who writes another extension's state: a range dragged across a time chart sets `TIME` (`ChartFrame`);
a fixed range applied or shifted turns `REFRESH` off (`time-range`); a table cell's SQL filter runs the
command `filters.addSql` *(proposed: a command, as `filters.offer`, so the chip rules stay the filters
extension's)*; the form widgets set their param in `PARAMS`.

Every data handler reads the same query parameters; the server parses them once in `lib/httpserver` into one
`QueryState` (time, filters, params). Params stay what they are today: ClickHouse parameters (`param_<name>`); the
client owns the UI, the server only binds.

✅ (step 6.1) **The request carries the page URL's own keys:** `time`, `range`, `sql`, `wp` (no JSON parameters
`filters` / `params`). `requestParams()` sends `time` also when it is the page's default, since the server does not
know the page's default. `httpserver.ParseQueryState(r)` reads them once per request; a missing `time`, a
`time` that is neither a Go duration nor `custom`, or a `wp` that is not a JSON object of strings fails the request
with that reason (chart error, 400 from `/time-range` and the alert widgets). A `sql` while `filters.sqlEnabled` is off
(§3.15, step 9a) fails it where the chip would enter the query (`QueryState.SqlClause`, since step 9v). A chart with `FromFileWithoutFilters` /
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

**Auto refresh pauses in a hidden tab** (decided 2026-10-30; the `refresh` extension's since 9j): it refreshes the
active tab one interval after that tab's last refresh, of any cause (*(proposed)*: before, the interval kept its
phase from the setting); nothing while `document.hidden` or for a tab in the background (`page.activeTab`,
`onDidChangeTabs`); shown again, a tab whose interval passed meanwhile refreshes once, the next refresh a whole
interval after that; picking an interval starts it anew.

✅ (step 6.1) **Alerts:** alert widgets only need the time range, so they read `time` / `range` like every other
handler and never `sql`: an alert chart's `{{DASHICA_FILTERS}}` is the window alone (`httpserver.TimeClause`).
Dashboard filters do not apply to alert widgets, and alert evaluation (`lib/alerting`) is not touched.

### 3.8 Filters: signed pills on a table, explicit

**A pill is a condition on a table that the server wrote and signed** (decided 2026-10-31, D6 of §3.14, step 8e;
maintainer: "THIS MUST BE SIGNED AS OTHERWISE WE CAN INJECT SQL LATER ON"). It replaces the filter as an id, an op and
a value that each chart interpreted (6.3 / 6.4, kept below as history). The client never sends a condition, only a key
the server made:

- **The widget's field makes the pill, on the server.** Filtering from a widget's data (a chart mark, a table cell,
  the filter bar's "add filter", §3.14 D4, D15) asks that widget: `GET <dataUrl>/pill?field=<alias>&value=<shown
  value>&op=eq|ne|lt|le|gt|ge` → `{key, label}` (the four range ops since 9k, §3.15 D25; the `type` parameter of 9k
  gone since 9q, D29).
  The field's condition is by default `(<field expression>) <op> <quoted value>` (`=`, `!=`, `<`, `<=`, `>`, `>=`,
  `sql.Op.Compare`); a computed field says its own, for the op it is given:

  ```go
  sql.Field("replace(customer_project, 'customer-', '')").WithAlias("customer").
      FilterAs(func(op sql.Op, value string) string { return op.Compare("customer_project", "customer-"+value) })
  ```

  A pill applies to every chart on its table, so its condition must hold on the table: a SQL file's field that is
  only an output alias (`extract(message, 'reason=([^ ]+)') AS reason`) says its expression with `FilterAs`, else the
  pill fails the other charts on that table (`UNKNOWN_IDENTIFIER`).

  `sql.Quote` writes a ClickHouse string literal: `'…'`, with `\` and `'` escaped by a backslash. A field that cannot
  filter (a count, a time bucket, a constant such as a fixed colour (since 9p, §3.15 D27), any field of a chart
  without a table) answers 422; with `FilterAs` the condition
  writes the op itself (until 9k `ne` was `NOT (<its condition>)`). The widget's node in `page.json` says which of its fields can filter, so the quick pick
  offers only those: `filterable` beside `dataUrl` (the aliases of its dimensions that are categories, when its query
  has a table and does not skip filters) *(proposed: on the node, not in each type's props, since every chart has it;
  it replaces the table's `categories` prop)*. Since 9p (§3.15 D27) a column of the chart's table makes a pill too
  (`/pill?column=<name>`, checked against the schema), and `computed` names the filterable fields that are more than
  a column.
- **The key** (since 9q, §3.15 D29; before, `<payload>.<mac>` with the pill as base64url JSON, ~330 characters) is
  readable and short (`filter.Sign`): `<table>.<field><op><value>[~<condition>]~<mac>`, e.g.
  `mv_oekokiste_shop.shopAction=driver-locate~(action) = 'driver-locate'~kq3V…` or, for a column,
  `mv_oekokiste_shop.host=web-1~Zp8x…`; a button's `@<queryPart>[~<value>]~<mac>`. The mac is an HMAC
  (`crypto/hmac`, SHA-256) over everything before it, made with `filters.secret` from `dashica_config`, truncated to
  128 bits, in unpadded base64url (22 characters). No label is in it: the chip shows `field op value`, which the
  client reads, with the field, op and value it edits a pill by, from the key (`pillLabel`, `pillField`), not from
  the `label` that `/pill` still answers beside the key. The secret is **required**: the server refuses to start without it. It is
  never in a checked-in file: the checked-in `*-production.yaml` names the environment variable (`FILTERS__SECRET`,
  as it does for `CLICKHOUSE__DEFAULT__PASSWORD`). The URL keeps `?f=<key>`, repeatable, in chip order with `sql`.
- **Checked on every request:** a pill whose HMAC does not match (tampered, unsigned, made with another secret)
  fails the request with 400.
- **A chart applies a pill when its base table is the pill's table** (`sql.From`, with database and connection): the
  condition goes into its WHERE (a SQL file's `{{DASHICA_FILTERS}}`); else its Diagnostics say "ignores customer".
  Two bases on the same table with different WHEREs share the pills; the same column in two tables is two pills.
- **A SQL file takes pills only when it names its table:** `sql.FromFile("x.sql", sql.Table("default.http_logs"))`.
  Without `sql.Table` it takes none, but still the time range and the SQL chips.
- **Pills on the same table and field combine:** the `eq` ones OR-ed, the `ne` ones AND-ed (since 9k those of every
  other op too, so a `≥` and a `≤` make a range); a pill holds one value. A column and a computed field of the same
  name are two fields (since 9ac, D27).
  *(proposed)* the key also carries the field's alias, signed, so the server knows which pills share a field (built so
  in 8e).
- **SQL chips** (`?sql=`) stay as they are, behind their own flag `filters.sqlEnabled` (§3.15 D16, step 9a).
- **What goes:** `filter.Apply`'s rule of the chart's own fields by alias, the base-table columns from `DESCRIBE
  TABLE` (`Client.Columns`, `Manager.Columns`, `filter.Columns`, the cache and its `singleflight`), the values bound
  as `{__f<i>:String}`, the unused `withFilters` interface, the `.Filterable` ideas. `Diagnostics` stays.

✅ **Built in 8e (2026-10-31)**, with these details and deviations:

- **The key** was `<payload>.<mac>` until 9q (§3.15 D29): the pill as JSON (`connection`, `table`, `field`, `op`, `condition`, `label`) and
  its HMAC-SHA256 over the payload's text, each in unpadded base64url (`filter.Sign`, `filter.Open`). *(proposed)* The
  label was inside the signed payload, so the URL needs only `f` and a reloaded page reads each chip's label from its
  key (`pillLabel`, since 9g in the `filters` extension's `pill-key.ts`, §3.15 D21); nothing reads the label as SQL.
- **`filters.secret`** (`config.FiltersConfig`) is checked by `dashica.New`, not by `LoadConfig`, so the db tools in
  `cmd/` and the test server load configs without it; *(proposed)* it must have at least 32 characters
  (`openssl rand -hex 32`). The handlers read it from the config injected as `rendering.Dependencies.Config` (since
  step 9v; before, a copied `FilterSecret`).
- **A table** is `filter.Table{Connection, Name}`: the query's connection (`OnDatabase`, else `default`) and its
  `sql.From` / `sql.Table`, a name without database in that connection's database from `dashica_config`
  (`clickhouse.Manager.Database`), so `full_logs` and `monitoring.full_logs` on Solarwatt are one table. A From that
  is no plain `[database.]table` (a subquery) is none; `sql.Table` on a builder query has no effect.
  `sql.FromFile(path, opts...)` takes options as `With` does.
- **Applying** (`filter.Apply`): the pills on the chart's table, grouped by field and op in the order of their first
  pill, each group one Where (`eq` OR-ed, `ne` AND-ed; since 9k every op but `eq` AND-ed); the others named by label in Diagnostics. A query that skips
  filters ignores all. Each request opens every `f` (`QueryState.Pills` holds the keys unchecked; the chart's handler
  answers the first one that does not open with 400, also for the charts it does not apply to).
- **The client** (8e): a pick in the click's quick pick asks the widget's `/pill` and adds `{key, label}`
  (`addChip` on the query state `filters` since 9j, before `FiltersModel.add(pill)`; since 9g only `{key}`, §3.15 D21); a failed answer adds nothing and goes to the console. Since 9f (§3.15 D20) the quick
  pick is the `filters` extension's command `filters.offer(at, candidates, { dataUrl, filterable })`, which a chart,
  a table cell and the Explore view's group row run (the Explore view with its chart); it adds to the tab shown. A pill chip shows its label and ×; it is not edited (its condition is
  the server's) and the `=` / `≠` flip goes *(proposed)*; 9c makes it editable again through the server (§3.15 D18). `WidgetContext.addFilter` goes.
- **The Explore preview** (`lib/explore`) still drops `f`: its widget comes from the request.
- **Tests:** `sql` (Quote, Condition, FilterAs, TableOf), `filter` (TableOf, New, Sign / Open and every refused
  key, Apply's grouping and two bases on one table), `widget` (`/pill`, its 422 and 400, pills applied and ignored,
  a SQL file with `sql.Table`, a tampered pill 400, `filterableFields`), `config` (the secret's length); vitest for the
  chip model, the filter bar, `offerFilters` asking `/pill` (since 9f in `extensions/filters/offer.test.ts`; the
  renderers' tests check the runs of `filters.offer`, `widgetTestbed().offers`). Playwright (written, not run): `e2e/filter-chips.spec.ts` signs its pills through a chart's `/pill`, an
  unsigned `f` fails the charts with 400.

✅ **Built in 8m (2026-10-31): "Add filter"**, a pill without a click on a chart (§3.14 D15, as Grafana's ad hoc
filters):

- **The node names its table:** `table` beside `filterable` in `page.json` (`default.http_logs`, as `filter.Table`
  names it), set when the node has filterable fields (since 9p whenever its query has a table, §3.15 D27); with its
  `connection` it groups the page's fields by table (`filterableTables`: each field once, served by the first chart
  naming it; since 9p the table's columns from its first chart's `/columns`).
- **The filter bar's "Add filter"** after the chips, while a chart of the page filters a table (so the bar shows on
  such a page even without chips or buttons *(proposed)*): quick picks below the button for the table (skipped when
  there is one *(proposed)*), the field, `=` or `≠` (since 9k the ops of the field's type, §3.15 D25), then the value;
  the value goes to that chart's `/pill` and the pill into the filters; Escape at any step adds nothing.
- **The value** (`pickValue`, `ui.createQuickPick`): the values `<dataUrl>/values?field=<alias>&search=<text>` answers
  in the tab's query state, asked again 200 ms after the typing rests (the request before aborted); the typed text
  itself first, "as typed", when it is none of them, so a value beyond the first 100 can be chosen *(proposed)*.
- **`/values`** (`valuesHandler`, `sql.Values`, `httpserver.HandleValues`): a JSON array of at most 100 strings, sorted
  (since 9k `{type, values}`, the field's type beside them, §3.15 D25).
  A builder query's base (its From and Where, without its own SELECT, GROUP BY, ORDER BY and LIMIT): `SELECT
  toString(<definition>) AS __value FROM <table> WHERE <its Where> AND positionCaseInsensitive(toString(<definition>),
  {__search:String}) > 0 AND <time range, SQL chips, pills> GROUP BY __value ORDER BY __value LIMIT 100`. A SQL file's
  field is a column of its result, so its values come from that result in a subquery (its own LIMIT included)
  *(proposed)*. The search is a bound parameter, never SQL text. 422 for a field that cannot filter (as `/pill`), 400
  for an unsigned pill. The pills on the asked field are left out *(proposed)*, so a second value can be OR-ed to one
  filtered by.

**To check** (against CI's ClickHouse; written as `query_filters_e2e_test.go`, not run in the sandbox): a quoted
literal compares with the column types the bound `String` did (below, checked 2026-10-30 for parameters):
`status = '500'` against a `UInt16` column, `'abc'` fails, a value with quotes stays one literal.

**History (6.3 – 7b, replaced by step 8e):** until 8e a filter was `{id, op, value}` (`?f=status:eq:500`), its value
bound as a ClickHouse parameter, and each chart interpreted the id: one of its own fields by alias, else a column of
its base table (`DESCRIBE TABLE`, cached), a SQL file its own output columns; a chart could implement
`ApplyFilters(q, filters) (q, Diagnostics)` instead. The paragraphs below record how that was built.

✅ Checked 2026-10-30 on ClickHouse 25.9 (`clickhouse local`): a `String` parameter compared with `UInt16`,
`Nullable(UInt16)`, `Float64`, `DateTime` and `LowCardinality(String)` columns converts and matches (`=`, `!=`, also
`IN {p:Array(String)}`); a value that does not convert (`abc` against `UInt16`) fails the query with `TYPE_MISMATCH`
(code 53), which the chart shows as its error. So filters carry no type.

**Diagnostics** is what a chart tells the outside about one answer, a value returned with the query (kept by 8e):

- `Ignored []string`: the filters it does not apply, each once, in URL order (from 8e: their labels);
- `Skipped string`: non-empty when the chart did not run, and why;
- more fields later, as charts need to say more.

The handler sends it as one response header, `X-Dashica-Diagnostics: {"ignored":["host"]}` (JSON; no header when it
is empty; since 9u percent-encoded, Go `url.PathEscape`, the browser `decodeURIComponent` before `JSON.parse`, since
browsers read header bytes as Latin-1: `%7B%22ignored%22:%5B%22customer%20%E2%89%A0%20acme%22%5D%7D`), beside
`X-Dashica-Resolved-Time-Range`. A skipped chart answers without running ClickHouse. `ChartFrame` shows the Diagnostics: no
badge when they are empty, "ignores `host`", "skipped: …" in place of the chart. The chart still renders without the
filters it ignores. A runtime `UNKNOWN_IDENTIFIER` (ClickHouse code 47, e.g. from the free
SQL chip) fails that chart only, with the column named. No query parsing.

✅ **Done in 6.3 / 6.4 (history, replaced by step 8e), with these deviations from the first sketch (2026-10-30):**

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
(since 9ae `diagnosticsOf(result)` in `filter-library`, §3.15 D38) is the header's JSON (`{ignored?, skipped?}`, `{}` without it; a 204 is an empty table); `ChartFrame` shows "ignores
host, path" in the chart's title row (since 2026-10-31: the frame draws every chart's title, Plot and the table draw
none), hidden while it ignores none, after a failed query and while skipped, with the chart's drawing muted while
it shows (D28, since 9r), and "skipped: …" (`d-chart-frame__skipped`) in place of the chart. Since 9af (§3.15 D38)
the `filters` extension shows them as widget decorations (`filters/decorations.ts`, `filterDecorations`): a badge
"ignores <label>" per ignored pill (muted, tooltip "The chart does not apply the filter <label>"), or for a skipped
chart only "skipped: <why>" (unmuted); `ChartFrame` draws them as badges (`d-chart-frame__decoration`,
`data-testid="chart-decoration"`) and the body of a 204 empty *(proposed: one badge per pill, the skipped text as a
badge rather than in place of the chart)*.
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

✅ (step 8c, §3.14 D3, D4) **A click filters in one step; the floating bar and the selection are gone** (the two
6.7 / 6.8 parts below are history). A click on a chart mark (the mark `chart-library/filterOnClick`, until 8c
`selectOnClick`, its candidates as in 6.8), on a category cell of a table, or on a group row of the Explore view calls
`offerFilters(at, candidates)` (until 9f `WidgetContext` / `WidgetsApi`; since 9f, §3.15 D20, the command
`filters.offer(at, candidates, { dataUrl, filterable })` that the click runs itself, `offerFiltersOf` (`chart-library` until
9ad, since then `filter-library`, §3.15 D38);
the `filters` extension registers it, owns the quick pick, `OP_ICONS`, `fetchPill`, and adds to the tab shown;
without it a click offers nothing): the quick pick "Filter" at the click (a table cell: below the cell) lists, per candidate in order,
`<field> = <value>` with a filter icon (accessible name "Filter …", op `eq`) and the same with a minus icon
("Exclude …", `ne`); it is a menu (§3.15 D30), typing narrows them, choosing one adds the filter to the tab's query state at once, Escape or a
press elsewhere adds none. Deleted: `ui.registerFloatingBar` (`floating-bar.ts`), the menu `widget/selection` and the
`filters` commands `filters.filterBySelection` / `excludeSelection`, `WidgetsApi.selection` / `select` /
`clearSelection`, `WidgetContext.select` / `choose` / `clearSelection`, the `Selection` types, `ui.showChoices`, the
Explore view's anchor element. The table's `selecting` is `filtering`, its class `d-table__filterable`. Each click
adds one pill; how pills on the same table and field combine is the server's (8e). The labels show `=` for both ops
and the icon tells them apart *(proposed: D4 names both "`<field> = <value>`")*. Tests: `offerFilters` in
`extensions/filters/offer.test.ts` (until 9f `widgets.test.ts`), a click per chart type and the table cell in their
tests (since 9f the runs of `filters.offer`, `widgetTestbed().offers`; before `choices()` / `candidates()` /
`choose(…)`), the Explore view's click in `view.test.ts`. Playwright (written,
not run): `e2e/bar-selection.spec.ts`, `e2e/chart-selection.spec.ts`, `e2e/record-details.spec.ts`.

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
| ~~Show rows~~ | **DROPPED 2026-10-31**, superseded by Explore | ~~`row-details` (drill to detail, §6)~~ |
| a Go action | as declared (§3.9) | `page-actions` |
| Open in Explore | either | `explore` (later) |

So "both zoom and filter" is no either-or: they are two entries, and later ones (actions) need no new UI.

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
bar. `chart-library/selectBars` (from 6.8 the mark `selectOnClick`) makes the bars of a Plot bar chart selectable. On a click
on a bar (Plot binds each `rect` to its row's index), it selects the value in that row of the first of the given fields
that is a category (by its alias): a bar chart's category (`x` / `y`), then its `fill`. A NULL selects nothing.
Without such a field the bars are not selectable and get no pointer cursor. `fx` / `fy` and the color legend are
6.8. Tests: `floating-bar.test.ts`, the selection in `widgets.test.ts`, the entries in `filters.test.ts`, a click to
a filter in `bar-vertical.test.ts`. The widget testbed now runs a real `UiHost` and `CommandsHost`. Playwright:
`e2e/bar-selection.spec.ts`. **Open:** a refresh redraws the chart, so the selected bar leaves the page. The bar
then hides at the next scroll or resize, but the selection stays until Escape or a click; the selected bar is not
highlighted.

✅ (step 6.8, reworked 2026-10-31) **Every chart and table cell selects through the same bar.** A chart selects
through **a Plot interaction mark** of its own, `chart-library/selectOnClick(mark, data, {...options, fields,
choose})`, put after its mark as Plot's tip is: `mark` is the chart's mark function (`Plot.barY`), `options` the chart
mark's options without its tip, so the mark under Plot's pointer transform (`Plot.pointer`, as Plot points a
`tip: true` or `tip: {channels}`) points at the same row as the tip, a stack included. It draws an empty `g`, with
`d-select-on-click--pointing` while it points at a row (the SVG then has the pointer cursor, `svg:has(…)`); its render
function gets the pointed row's index (documented: a render transform, `context.ownerSVGElement`), and reads the row
as Plot's pointer does (`data.get(i)`, Plot's source). A field is a candidate when it is a category: not a `count`,
not a time bucket (`autoBucket`, or a field with `xBucketSizeMs`); its alias is the filter id. A NULL is no
candidate. **A selection takes two steps:** a click on a mark always pops up a menu "Select" (also for one candidate,
so a click does the same each time) at the click, an entry per category of the pointed row with a value, in the
order of `fields`, labelled `<alias> = <value>` (`instance = web-1`, `status = 500`, `region = eu`). Choosing one
selects it (`{kind: 'category', fieldId, value, anchor: the clicked element}`) and the floating bar follows; Escape or
a press elsewhere closes the menu without selecting. A row without a category value pops up nothing; a chart without a
category field gets no mark. The menu is `WidgetContext.choose(at, candidates)`: it labels the candidates and shows
them with `ui.showChoices(entries, {anchor, title})`, an arbitrary menu (`{label, run}` entries, no commands) drawn by
the context menu's list (keyboard, focus, Escape, one menu at a time); without entries it changes nothing, an open
menu stays. **Plot pins its tip on a mouse's click** and then ignores the mouse until the next click unpins it, so a
second click would select nothing (Plot's source only, `pointer.js`: `pointerdown`, `state.sticky`; its typings say
nothing of pinning): the mark stops a mouse's `pointerdown` at the SVG (capture phase) while it points at a row,
before Plot's listeners there (Plot stops the same events itself); a touch or pen, on which Plot pins nothing, passes.
On a faceted chart Plot's pointer renders the mark once per facet and empties the losing facets' elements an
animation frame later, so a click reads the row of the element that points. The floating bar takes the role of the pinned tip. **Legends no
longer select** (2026-10-31): Plot's legend is HTML outside the SVG, and its swatches' order was Plot's source only.
`selectMarks(chart, fields, select)`, which wrapped the drawn chart, read `plot.value` and picked the first category,
is gone. The candidates per chart:

| Chart | Candidates, in order |
|---|---|
| `barVertical` | `x`, `fill`, `fx`, `fy` |
| `barHorizontal` | `y`, `fill` |
| `timeBar` | `fill`, `fx`, `fy` |
| `timeLine` | `zField`, `strokeField`, `fx`, `fy` |
| `timeHeatmapOrdinal` | `y` (its cells) |

**Facet labels no longer select** (2026-10-31): Plot has no API for which facet a label names. A mark's row carries
its facet's value, so a click on a mark offers its facet as well. `timeHeatmap` has no selection mark: its `y` is a
numeric bucket and its `fill` a measure. A line offers its own series (`zField`) before its color group (`strokeField`), as a
bar its category before its fill. **A time chart's drag area (`timeBrush`) lies above its marks**: Plot's pointer and
the mark listen on the whole SVG, so a click there offers the row Plot points at, as one on the mark (the selection's
anchor is then the drag area). A click without moving starts no time selection, and `timeBrush` is unchanged. An
alert's chart (`alertDetail`, `drawTimeBars` without `choose`) selects nothing. The table: `drawTable(result, props, select?)`; with `select`, a click
on a cell of a category column (Tabulator's `cellClick`) selects `{fieldId: the column's name, value: String(cell),
anchor: the cell}`, a NULL nothing, and the category columns carry `d-table__selectable`. A table's props carry
`categories` (step 6.9, its `computeProps`; since 8e the node's `filterable`, §3.8): the aliases of its own fields (`dimensions()`) that are categories, so
its GROUP BY fields, or all its selects for raw rows, without counts and time buckets. A column Arrow types as map,
list or struct holds no category on the client either. **Deviation:** a SQL-file table has no categories, since its
output columns are only in its text, so its cells select nothing (open question 8). The 6.6 entries "Filter by …" /
"Exclude …" leave the cell menu: it keeps "Filter: Contains this value", a timestamp column its "Time ±…" entries.
Since 2026-10-31 these entries are the `table` extension's in the menu `table/cell` (below, "Menu ids"), their
commands add to the SQL filter themselves, and `dashica-add-filter` is gone. Debug's table passes no `select`,
selects nothing and keeps all its SQL entries. Tests: a click per chart type in its extension's test, through Plot's real pointer (`chart-library/plot-testing.ts`
moves the mouse onto a mark, waits a frame, presses and clicks; it gives jsdom an empty `getBBox` for Plot's tip):
the candidates in order, also a single one, choosing one and the floating bar, a second click, measures, time
buckets and NULL never offered (`bar-vertical.test.ts`), a mark's facet, the drag area (`time-bar.test.ts`,
`time-line.test.ts`); `ctx.choose` in `widgets.test.ts`, `showEntries` in `context-menu.test.ts`; the cell click, the
category columns and the menus in `table.test.ts`, the categories in `table_test.go`. Playwright:
`e2e/bar-selection.spec.ts` (a bar, its menu "Select", Escape on it), `e2e/chart-selection.spec.ts` (a time bar through
its drag area, a table cell, the cell menu). **Open:** the
ordinal heatmap's y-axis labels and a table's header do not select; a click that ends a text selection in a table cell
also selects the cell.

**The SQL filter is a chip** (decided 2026-10-31, step 7b; maintainer: "the pills for filtering and the SQL filter
still existing do not nicely fit together; two things for the same concept"). The filter bar holds **one list of
chips**: structured ones (`status = 500`, `host ≠ b`) and SQL ones (`SQL: duration > 2000`). Every chip is removed
(×) and edited the same way, several SQL chips AND together, and the free SQL textarea that every query adds to its
WHERE is gone. What exists today, and what changes:

| Today | Where | Becomes |
|---|---|---|
| one `?sql=` (`url.get('sql')`), one string in `FiltersModel.sql`, typed live into a textarea under the funnel | `frontend/hosts/query/query-impl.ts` (`FiltersState`, `parseSearch`, `formatSearch`, `requestParams`), `frontend/extensions/filters/filters.ts` (`FilterBar`) | one `?sql=` per SQL chip, repeatable; a SQL chip is applied on Enter, not per keystroke |
| `add(condition)` appends `\nAND <condition>` to that string (filter buttons, the table cell menu's "Contains" and "Time ±…") | `query-impl.ts`, `filters.ts`, `frontend/extensions/table/table.ts` | `add(condition)` adds one SQL chip (once: the same text again is no change); the callers stay as they are |
| a filter button adds its `queryPart` to the SQL string (asking for `...`), nothing shows it was pressed | `filters.ts` (`showButtons`, `#add`); `dashboard.Builder.FilterButton`, `rendering.FilterButton` | a toggle: pressed while a SQL chip matches it, that chip not shown in the chip row (step 8f) |
| `QueryState.Sql string` (`query.Get("sql")`); `SqlClause` adds `AND (<sql>)` after the window | `lib/httpserver/query_state.go`, `lib/httpserver/time_range.go` | `QueryState.Sql []string`; `SqlClause` adds `AND (<sql>)` per chip |

Unchanged: how Go applies the result. `SqlClause` is still the one condition `prepare` adds as `sql.Where` (so a SQL
file receives it in `{{DASHICA_FILTERS}}`), Speedscope adds it the same way, alerts read only `time`, Debug's
`filterClause` shows it, `SkipFilters()` / `FromFileWithoutFilters` skip it. No contract change: `page.json`'s
`filterButtons` (`{title, queryPart}`) stay, nothing is regenerated.

- **URL:** structured chips as today (`?f=status:eq:500`), each SQL chip one `sql` (`?sql=duration > 2000&sql=level !=
  'info'`). The query string keeps the chips' order across both keys (`URLSearchParams` keeps the order of its
  entries): `parseSearch` reads its entries in order, `formatSearch` deletes `f` and `sql` and appends every chip in
  order, `requestParams()` sends them so. **Today's URLs keep working:** a single `?sql=` is one SQL chip with that text,
  also one written by the old appending (`a \nAND b` is one chip). An empty `sql` (`?sql=`) is no chip.
- **Chip model, a value** (`frontend/hosts/query/query.ts`; `FieldFilter` gets its `kind`):

  ```ts
  /** A chip of the filter bar: a structured filter (`?f=`), or a SQL condition every query of the page adds to its WHERE (`?sql=`). */
  export type FilterChip =
    | { readonly kind: 'field'; readonly fieldId: string; readonly op: FilterOp; readonly value: string }
    | { readonly kind: 'sql'; readonly sql: string };

  export interface FiltersModel {
    /** The chips, in the order they were added, as the URL holds them. */
    readonly chips: readonly FilterChip[];
    /** Adds a SQL chip `condition` (a filter button, a table cell's "Contains"); once. */
    add(condition: string): void;
    /** Adds the structured chip `fieldId` `op` `value`; once. */
    add(fieldId: string, op: FilterOp, value: string): void;
    /** Puts `chip` in place of the chip at `index` (an edit); a SQL chip of only spaces removes it. */
    replace(index: number, chip: FilterChip): void;
    remove(index: number): void;
    /** Removes every chip. */
    clear(): void;
    readonly onDidChange: Event<void>;
  }
  ```

  `sql`, `setSql` and `fields` go (their callers are `query-impl.ts`, `active-query.ts`, `filters.ts`; `widgets-impl.ts`
  and `table.ts` call `add` only). `QueryState` (TS) has `chips` in place of `sql` and `fields`.
- **How Go applies several SQL chips:** `ParseQueryState` reads `query["sql"]`, leaving out empty ones, into `Sql
  []string` in URL order. `SqlClause(timeRange)` is the window and then ` AND (<chip>)` per chip:
  `timestamp >= 1761724800 AND timestamp <= 1761746400 AND (duration > 2000) AND (level != 'info')`. Each chip in its own
  parentheses, so a chip `a OR b` stays one condition. One request with several `sql` changes nothing else: one WHERE,
  one `{{DASHICA_FILTERS}}`, the structured chips bound as `{__f<i>:String}` as before. The trust model stays (free SQL
  from every authenticated user, §6 "Permissions").
- **The filter bar** (`FilterBar` in `filters.ts`): one row of chips in the model's order, then the page's buttons.
  A structured chip shows `id`, `=` / `≠`, value; a SQL chip shows `SQL:` and its text on one line (cut with an
  ellipsis, the whole text in its `title`). × removes a chip (`remove(index)`).
  - **Adding** (since 9o, §3.15 D26): "Add filter"'s advanced entry "SQL condition…" asks the condition in an input
    box (`showInputBox`; since 9aa its field the SQL editor, `showSqlInputBox`, Shift+Enter a new line) and adds it at
    the end of the chips; Escape or an empty text adds none. Until 9o the
    funnel in the top bar opened a new, empty SQL chip in edit mode instead. The funnel's dot (marked while a SQL filter was set) goes:
    the chips show what is set. (proposed)
  - **Editing, the same for every chip** (proposed): a click on a chip's text puts it in edit mode in its place, one
    chip at a time. A SQL chip edits its text in a textarea (`d-field--mono`, Shift+Enter a new line; since 9aa in the
    SQL input box below the chip instead, its text filled in and selected: Enter applies, an empty text removes the
    chip, Escape or a press elsewhere keeps it *(proposed)*); a structured
    chip edits its value in an input, and a click on its `=` / `≠` flips the op. Enter or leaving the field applies it
    (`replace(index, chip)`), Escape cancels it, an empty SQL text removes the chip. The URL changes once per applied
    edit, not per keystroke.
  - **Shown** while there is a chip, the page has buttons, or "Add filter" offers something (a filterable table, or a
    SQL condition while `filters.sqlEnabled` is on); on a page with `filterBar` only, as today.
- **A filter button is pressed in place while toggled on** (step 8f, D7; signed since step 9b, §3.15 D17): its
  filter is a signed pill without a table (`filter.NewButton`), its condition the button's `queryPart`, a `...` in it
  replaced by the value as a string literal (`sql.Quote`) on the server; no new URL key (`f`). A pure function in
  `filters.ts`, `buttonOf(chip, buttons)`, gives the button a pill was made for: the key's `button` (`pillButton`)
  equals its `queryPart`; the value is the key's `value`. Such a chip is not drawn in the chip row; the button stays
  where it is, pressed (`aria-pressed="true"`), its `title` its `queryPart`. A pressed `...` button shows each value
  beside its title (`Host` `app.wetell.de`, one control) *(proposed)*; a click on a value asks a new one and replaces
  that chip in place, a click on the title removes every chip of the button. Pressing it otherwise adds its pill
  (asking for `...` with `showInputBox`, named after the button, the condition the value makes shown below the field
  as it is typed, an empty value refused; since 9z, D37). So a link with the key of "Errors only" opens with it pressed and no chip;
  on a page without that button it is a pill chip, labelled with the button's title (`Path: /api`) *(proposed)*. The
  SQL chips stay unsigned (D6): with `filters.sqlEnabled` on (§3.15 D16), a `?sql=` link still runs the viewer's own
  SQL in every chart's WHERE, also while Explore is off.
- **The table cell menu** ("Filter: Contains this value", the timestamp entries) adds a SQL chip through `add(condition)`
  as before; each entry is now a chip of its own, removable alone. Only with `filters.sqlEnabled` (§3.15 D16).
- **The Explore view's tab** shows the same chips; how they apply to an edited query is the Perspective concept's
  (`docs/2026-10-30-perspective.md`, "Editable SQL").
- **Tests:** `query.test.ts` (two `sql` and `f` interleaved keep their order through `parseSearch` / `formatSearch`, a
  single old `sql` is one chip, `?sql=` none, `add(condition)` once, `replace`, `remove`), `filters.test.ts` (a SQL chip
  from "Add filter"'s "SQL condition…" (since 9o; the funnel before), editing a SQL and a structured chip, Escape, `buttonOf` of a button's pill, a pressed button
  has no chip and removes its filter, a `...` button shows its values and takes a new one in place), Go: `query_state_test.go` (several `sql`, an empty one), `time_range_test.go` (`SqlClause` with
  two chips). Playwright: `e2e/filter-chips.spec.ts` (a link with two `sql` shows two chips, "SQL condition…" adds one (the funnel until 9o), × on
  one, a filter button toggles in place without a chip).

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

- **Errors where they happen:** a query error shows in its chart (short message) and, while the chart is active, in
  the status bar, whose click opens Debug; an action or navigation error is a notification; an unknown page shows "not found" in
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
  registerCommand(id: string, handler: (...args: any[]) => unknown,
                  o?: { enablement?: () => boolean; disabledReason?: string }): Disposable;   // as VS Code's enablement (9t)
  executeCommand<T>(id: string, ...args: unknown[]): Promise<T>;   // runs whatever the enablement (code means it)
  enablement(id: string): { enabled: boolean; disabledReason?: string };   // asked by menus, keys, rail, search everywhere
  getCommands(): readonly CommandContribution[];      // what the palette lists
  keybindingLabel(id: string): string | undefined;
}

// ui — regions, menus, input, messages
interface UiApi {
  registerSidePanel(id: string, o: { label: string; icon: string; side: 'left' | 'right'; order?: number;
                                     when?: (p: Page) => boolean }): Panel;     // command workbench.view.<id>;
                                          // its header: name in caps, "…" shows menu panel/<id> ("Hide") (8d)
  registerRailButton(id: string, o: { label: string; icon: string; command: string; side?; alignment?; order? }): Disposable;
                                          // a rail button running a command (search everywhere) (8d)
  registerBarItem(bar: 'top' | 'filter' | 'status', el: HTMLElement,
                  o: { alignment: 'left' | 'center' | 'right'; priority?: number }): Disposable;   // top: around the tabs

  registerMenuItem<C>(menuId: string, item: MenuItem<C>): Disposable;    // when (shown) / toggled / group / order
  getMenuItems<C>(menuId: string, context?: C): readonly MenuItem<C>[];
  showContextMenu(menuId: string, o: { anchor: Element | {x: number; y: number}; context?: object; args?: unknown[] }): void;
                                          // the menu's entries in the quick pick as a menu at the anchor (8c, 9s)
  readonly onDidChangeMenu: Event<string>;

  showQuickPick<T>(items: (T | QuickPickSeparator)[], o?: { title?; placeholder?; anchor?; menu? }): Promise<T | undefined>;
                                          // typing narrows (fuzzy); a click's candidates, menus (8c); `menu`: no field in sight (9s)
  showInputBox(o?: { title?; prompt?; placeholder?; value?; valueSelection?; validateInput?; anchor?; field? }): Promise<string | undefined>;
                                          // a button's `...`; validateInput(value): string (an error, Enter blocked) or
                                          // { message, severity: Info | Error } below the field, live (9z, D37);
                                          // field: an InputBoxField of the caller's in place of the text field, e.g.
                                          // the SQL editor (element, input, value, select, focus, onDidChangeValue,
                                          // onDidAccept; 9aa)
  createQuickPick<T>(): QuickPick<T>;     // the owner sets the items as the text changes (search everywhere); `anchor`
  registerSearchProvider(p: SearchProvider): Disposable;               // search everywhere groups
  showInformationMessage / showWarningMessage / showErrorMessage(message: string, ...items): Promise<…>;
}

interface Panel extends Disposable {
  readonly body: HTMLElement; readonly visible: boolean;
  show(): void; hide(): void; readonly onDidChangeVisibility: Event<void>;
}

// a view inside a panel's body (§3.4.2): a pure helper exported from hosts/ui/ui.ts, no registry; the owner places the
// element and draws it anew; the collapsed state under `views.<id>.collapsed` in `state`, not kept without one
function createView(o: { id: string; title: string; description?: string; actions?: HTMLElement[];
                         collapsed?: boolean; state?: Memento; body: Node | Node[] }): HTMLElement;

// page — the open tabs and what each shows (§3.4.1)
interface PageApi {
  readonly workbench: WorkbenchJson;        // menu groups and outlines, explore, connections, from /workbench.json (generated type, §3.2)
  readonly tabs: readonly Tab[];            // {id, url, title}; activeTab, onDidChangeTabs, closeTab(id)
  readonly current: PageJson | undefined;   // the active tab's, from <url>/page.json (generated type); undefined while it loads or failed
  readonly onDidChangePage: Event<PageJson | undefined>;   // with `current`: another page, a failed one, every switch of tabs
  navigate(url: string, o?: { newTab?: boolean }): Promise<void>;   // fetch page.json, pushState, swap the tab's content
  popOut(view: { title: string; render(el: HTMLElement): Disposable }): Promise<void>;   // a view in a tab, in memory (§3.4.6)
  registerPageRenderer(kind: string, render: (el: HTMLElement, page: PageJson, context: PageContext) => Disposable): Disposable;
}                                           // `dashboard` by the extension dashboardPage; a kind in the hash (`#explore=3`)

// query — the state every query depends on (§3.7)
interface QueryApi {                        // knows no key of its own: typed keys (9w)
  get<T>(key: QueryKey<T>): T;              // never undefined: the key's URL value or its default
  set<T>(key: QueryKey<T>, value: T): void;
  onDidChange<T>(key: QueryKey<T>, listener: () => void): Disposable;
  refresh(): void;
  readonly onDidRequestRefresh: Event<void>;
  requestParams(): URLSearchParams;         // what every data handler reads; one format with step 6
}
// defined once where the state belongs (time-library, filters, widget-library), known to the host from its first use
export const TIME = queryKey<TimeRange>(['time', 'range'], { parse(url, page), format(value, page), sentToServer });

// widgets — renderers per widget type (§3.6)
interface WidgetsApi {
  registerWidget<T extends WidgetType>(type: T, render: (el: HTMLElement, w: WidgetOf<T>, ctx: WidgetContext) => Disposable): Disposable;
  readonly active: RenderedWidget | undefined;            // the active tab's active widget: Debug, Details, the status bar (§3.4.4)
  readonly onDidChangeActive: Event<void>;                // another widget or tab, the widget removed
  registerDecorationProvider(provider: WidgetDecorationProvider): Disposable;   // as registerFileDecorationProvider (9af)
}                                                         // a click to filter runs `filters.offer` (§3.8, 9f)

interface WidgetDecorationProvider {                      // asked when a widget's answer arrives, all again when it fires
  provideDecorations(widget: RenderedWidget, result: QueryResult): readonly WidgetDecoration[] | undefined;
  readonly onDidChangeDecorations?: Event<void>;
}
interface WidgetDecoration { badge: string; tooltip?: string; muted?: boolean; source: string }   // only how it shows

interface RenderedWidget {                                // the widget itself, as window.activeTextEditor (step 8b)
  readonly widget: WidgetNode; url(path: string): string; readonly lastResult: QueryResult | undefined;
  readonly status: WidgetStatus;                          // idle | loading | done {rows, ms} | error {message, ms}
  readonly onDidChangeStatus: Event<void>;                // records are the table's own: details.showRecords (§3.4.5, 9e)
  readonly decorations: readonly WidgetDecoration[];      // of all providers; none before an answer, after a failure
  readonly onDidChangeDecorations: Event<void>;           // the frame and Debug draw them (9af)
}

interface WidgetContext {                                 // what a renderer gets; excerpt
  readonly state: QueryApi;                               // its tab's query state
  query(signal?: AbortSignal): Promise<QueryResult>;      // sets the widget's status (the latest call only)
  url(path: string): string;
  renderChild(el: HTMLElement, child: WidgetNode): Disposable;
  showMenu(menuId: string, anchor: MenuAnchor, context?: object): void;
}

// filters — a click's candidates (§3.8, 9f): the renderer runs the filters extension's command; the contract is
// filter-library's (9ad, D38), the widgets host knows none of it
commands.executeCommand(OFFER /* 'filters.offer' */, at: MenuAnchor, candidates: FilterCandidate[], source: PillSource);
// FilterCandidate {fieldId, value, type?}; PillSource {dataUrl, filterable}: whose /pill makes the pill; offerFiltersOf(commands, widget)
```

Menus open from a visible button ("…", or the widget's menu button), never by a right click: on the web nobody
expects one. Menu ids: `page/title` (page actions), `widget/context` (a chart's menu: debug), `table/row` (a row's menu),
`dashboards/entry` (a menu entry: favorite), `table/cell` (a table cell's menu: its SQL filters) and `table/header` (a
column header's menu button: auto-size). **Deviation (2026-10-31):** `table/cell` opens on a right click, as the
cell's Tabulator menu did before it became a registered menu; Tabulator's own menus are gone. A table shows them through
`ctx.showMenu(menuId, anchor, context)`: the widget's `WidgetMenuContext` with the cell's (`TableCellMenuContext`:
column, value, timestamp, `filtering`) or the header's fields (`TableHeaderMenuContext`: column, `autoSize`,
`autoSizeAll`); Debug's result table through `ui.showContextMenu` with the cell's or header's alone. The `table`
extension contributes the entries (commands `table.filter…`, `table.autoSizeColumn(s)`). **Since 8c every menu is the
quick pick** (§3.14 D3), since 9s as a menu (§3.15 D30): `showContextMenu` shows the entries in it at the anchor, a line between
groups, a check mark for a `toggled` entry, an entry whose command is not enabled greyed (`aria-disabled`, choosing it
does nothing) with the command's `disabledReason` on hover (`QuickPickItem.disabled` / `tooltip`, set by `ContextMenu`
from `commands.enablement`; since 9t, §3.15 D31; 8g had `MenuItem.enabled` / `tooltip`), the command run right after the box closed (still in the viewer's
gesture). A menu of the moment needs no id: its owner calls `ui.showQuickPick(items, {anchor, title})` (a chart's
click: the `filters` extension's `filters.offer`, §3.8), with `menu: true` when it is a menu; `showChoices` is gone. A registered menu without entries hides the open box.
The "…" buttons say `aria-haspopup="dialog"`, the quick pick's role. The rule "never by a right click" stands, with
the `table/cell` deviation above *(proposed: D3's "right click" read as that one existing menu, no new right-click
menus)*.

**Enablement is the command's, a menu's `when` is visibility — as VS Code** (9t, §3.15 D31): a command says whether it
can run now (`registerCommand(id, handler, { enablement, disabledReason })`, VS Code's
`contributes.commands[].enablement`), so every place that shows or triggers it agrees: a menu entry, a rail button and
search everywhere's command list show it greyed with the reason on hover, its key does nothing (the key goes on to the
next binding or the content), and `executeCommand` from code runs it anyway. A menu entry keeps `when` (shown or not)
and `toggled`; it has no `enabled` or `tooltip` of its own.

Folders as in Zwiebelfisch: `frontend/core/<name>/` (primitives), `frontend/hosts/<name>/` (contribution points),
`frontend/extensions/<name>/` (one folder per built-in extension); `frontend/workbench/` puts hosts and extensions
together (`createWorkbench`). Tests sit next to the code (`<name>.test.ts`).

Built-in extensions:

| Extension | Contributes |
|---|---|
| `dashboards` | left panel "Dashboards" (groups, favorites, filter box) |
| `search-everywhere` | the palette (⌘K / Shift Shift, its button first in the left rail): pages, commands, favorites, chart titles |
| `time-range` | top bar: the range button with its panel (quick ranges, From / To, recently used), shift ‹ ›, zoom out ⊖, refresh (§3.7) |
| `refresh` | top bar: one split button, ⟳ refresh now (`refresh.now`) and the auto refresh interval (Off, 10s … 1h) |
| (log scale) | removed (decided 2026-10-30): the charts draw on a linear scale |
| `theme` | light / dark toggle |
| `filters` | filter bar: chips, filter buttons (a `...` asked with `showInputBox`), SQL chip, "Add filter"; the command `filters.offer` (a click's quick pick "Filter", its `/pill`, the pill added to the tab shown; 8c, 9f) |
| `debug` | left panel "Debug" (the active widget's query, stats, EXPLAIN, result, as views); the status bar's item (the active widget's status); `widget/context` "Debug" (§3.4.4) |
| `details` | left panel "Details" (the records `details.showRecords` gave it: a table's ticked rows, a view per record); the status bar's "N records selected" (§3.4.5) |
| `schema` | left panel "Schema", only with Explore, two views (`createView`): "On this page" (the tables the page's charts read, connection › database › table) and "All connections" (every connection › database › table), from `/schema.json`; `panel/schema` "Refresh" and "Show comments" (toggled, kept in `globalState`) (Perspective §4.8, 8h, 9x) |
| `chart-link` | `widget/context` "Copy link to chart" (`/p/shop#w=3`) |
| ~~`row-details`~~ | **DROPPED 2026-10-31**, superseded by Explore: no "Show rows" and no panel of its own; a table's rows go to Details (`details`), the raw rows behind a chart to Explore |
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

✅ As implemented (6a; the hash handling superseded by 7a, below): the outline (§3.2). The charts are a group of `search-everywhere` ("Charts", after
"Dashboards"), matched there so the page shown comes first. A widget with data carries `data-data-url` on its element,
where the dashboard page finds it. `navigate` to a hash on the page shown (a link without a query keeps the page's)
pushes the hash and fires `hashchange`, without loading `page.json`. A change of only the hash by the browser (a link
`#w=3` in the page, a typed hash, back and forward between two) neither loads `page.json` nor queries again: the
`query` host knows the query string it last read or wrote, and the browser fires `hashchange` itself. A load of
another page still running is aborted by either. The charts come in the order they were mounted (a grid's by
area name). "Copy link to chart" copies the page and the hash without the query state; the
next change of the query state drops the hash from the URL.

✅ Since 7a (tabs, §3.4.1): the hash is the tab's. `navigate` to a hash on the page shown pushes the tab's URL with
it, and a change of only the hash by the browser (back and forward, a link the browser followed) goes into the tab's
URL; neither fires `hashchange` nor loads `page.json`. The renderer reads it from `context.hash` and hears of it by
`PageContext.onDidChangeHash` (only its own tab's), and the `query` host knows no hash: a change of the query state
keeps the hash in the tab's URL (`/p/shop?time=1h#w=3`).

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

// lib/dashboard/filter — pure: the pills (§3.8, step 8e) and what a chart did with them
type Diagnostics struct {
	Ignored []string `json:"ignored,omitempty"` // labels of the pills the chart does not apply, in URL order
	Skipped string   `json:"skipped,omitempty"` // non-empty: the chart did not run, and why
}
type Table struct{ Connection, Name string }                                    // "default", "default.http_logs"
type Pill struct{ Table; Field, Op, Condition, Label string }                    // what a key holds
func TableOf(q sql.SqlQueryable, database func(connection string) string) (Table, bool)
func New(table Table, field sql.SqlField, op, value string) (Pill, error)      // sql.Condition; ErrCannotFilter
func Sign(secret []byte, p Pill) (string, error)                                // `?f=<key>`
func Open(secret []byte, key string) (Pill, error)                              // refuses a key not signed so
func Apply(q sql.SqlQueryable, table Table, ok bool, pills []Pill) (sql.SqlQueryable, Diagnostics)

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
| `lib/dashboard/widget` | `BuildComponents` + `CollectHandlers` → `withHandler` / `withChildren` and the framework's `Mount` (§3.13), `RegisterQueryHandlers` → `queryHandler`; ids assigned by the framework; markdown computes its HTML when mounted (`computeProps`), the schema table serves its DDL from its handler; charts implement `Query()`; `DataHandler(deps, w)`, a chart's `/pill` and its node's `filterable` (8e) |
| `lib/dashboard/filter` | new, pure: `Diagnostics`; since 8e the pills: `TableOf`, `New`, `Sign`, `Open`, `Apply` (§3.8) |
| `lib/dashboard/rendering` | `DashboardContext` loses `MainMenu` / layout concerns; `SearchBarOption` becomes `page.json` fields |
| `lib/httpserver` | `QueryState` (time, `f`, `tw`, `sql`, `wp`) parsed once (`f`: the pills' keys, checked by the chart's handler); the query handler takes the chart's query with its pills and Diagnostics and writes `X-Dashica-Diagnostics`; a skipped chart runs no query; `ConnectionRowsHandler` at `/rows?connection=` runs a blank Explore's query (8i) |
| `lib/clickhouse` | `Manager.Database` (a connection's database, for a pill's table); the `DESCRIBE TABLE` columns and their cache went with 8e |
| (tabs, §3.4.1) | no Go change: an Explore tab is its source page's URL with `#explore=<id>`, served by the same shell and `page.json` |
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
   `selectOnClick` never offers a count. The widget's JSON (`MarshalJSON`, all fields) is unchanged; Explore's Go code
   reads that, nothing reads the props. A field without an alias (`sql.Field("lower(host)")`) is aliased by its
   definition, as its result column is named; such an alias still shows the expression, so give it an alias.

### 3.14 The batch of 2026-10-31 (decided 2026-10-31, planned as steps 8a–8m)

The maintainer decided D1–D15 together; each step of §5 (8a …) builds its part and rewrites the sections it changes.
The Explore parts (D8–D13) are the Perspective concept's (`docs/2026-10-30-perspective.md`, §4.8).

- **D1 Start page (8a):** the time range, refresh and the status bar items show on every page, "/" included;
  `hasQueries` and `registerBarItemWhile` are deleted ("no magic, useless abstraction"; §3.4.3).
- **D2 Active widget the VS Code way (8b):** `widgets.active` is only a reference to the active widget (as
  `window.activeTextEditor`); `onDidChangeActive` fires only when another widget or tab becomes active. The widget
  object carries its status and its records, each with its own change event (as `editor.selections` /
  `onDidChangeTextEditorSelection`). `ActiveWidget`'s flattened copy of status and records and the one event for
  everything go. Debug listens to the active widget's status, Details to its records (§3.4.4, §3.4.5). Since 9e (D19,
  §3.15) the records are the table's own and Details hears of them by command.
- **D3 Quick input as VS Code (8c):** `ui.showQuickPick` / `ui.showInputBox` / `ui.createQuickPick`, drawn in place
  (anchored at the click or element; centred for search everywhere), typing narrows. `showChoices` goes; every popup
  moves to it: a chart click's candidates, the registered context menus (right click, the "…" menu buttons), search
  everywhere.
- **D4 Click to filter (8c):** a click on a chart mark shows at once, per candidate field, "⊕ `<field> = <value>`"
  (filter, a filter icon) and "⊖ `<field> = <value>`" (exclude, a minus icon) in the quick pick; choosing one adds the
  pill (D6). The floating "Filter by / Exclude" bar goes. No multi-value accumulation: pills on the same table and
  field combine, the `eq` ones OR-ed, the `ne` ones AND-ed (§3.8).
- **D5 Layout (8d; changed by D23, 9i: the sides full height, the tab row over the content only, "…" in the left rail, no icon):** one top row `[… global menu][Dashica icon][tabs][+] … [time range][refresh]`; the separate
  title bar goes, the filter bar stays below. Search everywhere is a button in the left rail (as Typst), not a field.
  Each side panel has a header row with its name in caps ("DEBUG", "DASHBOARDS") and a "…" for its actions; rail
  buttons have a hover tooltip with name and keyboard shortcut (§3.4).
- **D6 Signed pills (8e):** a pill belongs to a table, is made by the widget's field on the server
  (`<dataUrl>/pill`, `.FilterAs`, `sql.Quote`) and signed with `filters.secret` (HMAC-SHA-256), required at start; a
  chart applies it when its base table is the pill's table, a SQL file only with `sql.Table(…)`; a tampered pill is a
  400. The old rules go (§3.8).
- **D7 Filter buttons (8f):** a button stays where it is and shows pressed while its filter is active; no chip for it
  in the chip row (§3.8 "The SQL filter is a chip").
- **D8 Explore off (8g):** with `explore.enabled: false` the whole Explore extension is off (no chart menu entry, no
  Explore tabs); `HandleSql`, the edited-rows handler and the free SQL endpoint check it in their handlers and answer
  404 before any query. In the UI only the global "…" menu shows "Explore" greyed, hover "Explore is not enabled
  (explore.enabled)".
- **D9 Explore SQL (8g):** the key `xsql` is renamed `exploreSql` everywhere (Go, TS, tab hash, docs); the editor
  shows the chart's SQL with its ClickHouse placeholders (`{__from:DateTime64}`), the values listed beside it, and Run
  sends them again as parameters; `lib/clickhouse/inline_parameters.go` goes.
- **D10 Global "…" menu (8i, ✅ 2026-10-31):** left of the Dashica icon (since 9i at the left rail's start). "Explore" opens a blank Explore tab: a ClickHouse
  connection picker and an empty editor, run on a new per-connection endpoint behind `explore.enabled`; "Start from
  chart…" fills the editor from one of the shown page's charts.
- **D11 Schema view (8h, ✅ 2026-10-31):** a left side panel "Schema", a tree connection › database › table; a table
  opens structured as DataGrip does; one cached query set per connection, refreshable; the same data feeds the
  editor's autocomplete. Part of Explore: only with `explore.enabled` *(proposed)*; built as Perspective §4.8 says.
- **D12 SQL editor (8j; built in 9d and 9aa, ✅ 2026-10-31, §3.15):** CodeMirror 6 (`@codemirror/lang-sql`, a ClickHouse dialect by `SQLDialect.define`, its
  `schema` from D11), loaded only when Explore opens (and when a SQL condition is asked, §3.15).
- **D13 Explore (8k):** Perspective's settings panel opens with the view; "Reset" asks for confirmation first (✅ step 8k:
  `toggleConfig(true)`, `confirmReset` in the quick pick; Perspective §4.8).
- **D14 View pop-out (8l, ✅ 2026-10-31):** a side panel view pops out into its own tab, bound to the widget it showed
  then; the popped tab no longer follows the active widget; kept in memory only (gone after a reload). Details pops out
  to a tab comparing all selected records side by side; Debug pops out; "Open Speedscope" opens a new tab with
  Speedscope in an iframe. Built as §3.4.6 says.
- **D15 Ad hoc pills (8m, as Grafana's ad hoc filters):** an "add filter" button on the filter bar: pick a table,
  then a field (the filterable fields the shown page's widgets declare, per table), then `eq` / `ne`, then a value
  from a lazy `SELECT DISTINCT <expression> … LIMIT 100` over the time range on the base query of a widget with that
  field (`<dataUrl>/values?field=…&search=…`, typing narrows on the server); the value becomes a signed pill through
  that widget's `/pill` (✅ step 8m, built as the end of §3.8 says).

### 3.15 The batch of 2026-10-31, second part (decided 2026-10-31, planned as steps 9a–9k)

The maintainer decided D16–D18 after D1–D15 were built, D19 after D16–D18, D20 after D19, D21 after D20, D22 after D21, D23 after D22, D24 after D23, D25 after D24, D26, D27, D29, D30, D31, D32, D33, D34, D35, D36 and D38 after the steps before them; D12 (§3.14) is built in the same batch (9d, 9aa). Each step of §5 (9a
…) builds its part and rewrites the sections it changes.

- **D16 SQL chips behind their own flag (9a):** `filters.sqlEnabled` (default false) beside `filters.secret`,
  separate from `explore.enabled`. Off, every query a SQL chip would enter answers it with 400 before any query
  (since 9v, D35; in 9a every handler that reads the query state), and the filter bar offers no way to type SQL. On,
  the SQL chips work as before (§3.8).
- **D17 Filter buttons signed (9b):** a dashboard filter button becomes a signed chip (the HMAC and secret of the
  pills), so it works with D16 off. A button without `...`: `page.json` carries its condition already signed, and
  pressing it puts that key into the URL. A button with `...`: the typed value goes to the page's own server side
  (`<page>/button?i=<index>&value=…`), which writes it into the button's SQL as a quoted literal (`sql.Quote`) and
  returns the signed key; the browser never sends SQL. A button's chip applies to every query that takes filters (as
  the SQL chips do; a button has no table). A pressed button shows in place (D7); a click on a pressed `...` button's
  value asks a new one (`showInputBox`) and replaces its chip in place. Values are always quoted strings
  (`duration_ms >= '500'`); **to check:** how ClickHouse compares such a string with a number column.
- **D18 Pills editable (9c, as Grafana's ad hoc filter chips):** the signed key also carries the field's alias and the
  shown value. A click on the operator switches `=` / `≠`; a click on the value opens the quick pick of "Add filter"
  (lazy `/values`, the typed text offered). Each edit asks `/pill` again on a widget of the shown page with the pill's
  table and that field (`page.json`: `table` + `filterable`) and replaces the chip in place (same position). Combined
  pills stay separate chips, each editable. A pill no widget of the page can make again can only be removed; its
  tooltip says why.
- **D12 SQL editor (9d, ✅ 2026-10-31; 9aa):** as §3.14 says, and one editor for both places that take SQL (maintainer
  on D26: "this SQL snippet input should also use codemirror -> same infra"). Built: `frontend/extensions/sql-library/`
  (a library, §3.5): `codemirror.ts` is the entry of a bundle of its own, `public/dist/sql-editor.js`
  (frontendBuild.mjs), which `loadSqlEditors` imports on first use, as Perspective's (a dashboard loads none of it);
  `SqlEditors.create({ value, placeholder, label, testId, enterAccepts, completion })` gives a `SqlEditor` (`value`,
  `setCompletion`, `dispose`, and the `InputBoxField` of `showInputBox`). CodeMirror 6 with history, brackets,
  `autocompletion` and ClickHouse's dialect (`CLICKHOUSE`, `SQLDialect.define`: its keywords, types and common
  functions, backticks and double quotes for identifiers, single-quoted strings with backslash escapes, `#` comments);
  a keyword completes in capitals, a type or function as ClickHouse writes it (`keywordCompletion`); colours from new
  tokens `--color-code-*` (tokens.css, light and dark), its look as the page's fields (`EditorView.theme` on tokens).
  Completion of the schema (`completionOf(schema, table)`: database › table › columns with type and comment, the
  connection's database the default, a page table's columns also alone) from `/schema.json`, so only with
  `explore.enabled`; `Schemas` moved from the Schema view into the library. The Explore view's editor (in place of its
  textarea, Cmd / Ctrl+Enter runs): the chart's connection and table, a blank Explore's picked connection, followed on
  each pick (9d). The filter bar's "SQL condition…" and a SQL chip's edit: `showSqlInputBox(ui, editors, …)`, the input
  box with the editor as its field (`InputBoxOptions.field`; Enter takes the text, Shift+Enter a new line, an Escape the
  completion takes leaves the box open), completing the names of the page's first table's connection, that table's
  columns also alone (`conditionCompletion`), while Explore is on (9aa). *(proposed)* A SQL chip is no longer edited
  inline in the chip but in that input box below it (Escape or a press elsewhere keeps the chip; leaving no longer
  applies); a condition completes one table's columns alone (lang-sql has one default table), the first the page's
  charts read; each place keeps its own `Schemas` (the server caches the schema; the Schema view's "Refresh" does not
  reach an open editor's completion); while the editor's bundle does not load, the condition is asked in the plain
  input box and Explore shows "The SQL editor did not load" in the editor's place; identifiers count as case
  insensitive for completion only, so a completed `Status` gets no quotes. `@lezer/highlight` (CodeMirror's `tags`) is
  imported as the dependency of `@codemirror/language` it is: listing it in package.json needs `npm install` (the lock
  file), which this step could not run.
- **D19 Records by command (9e, decided after 9c):** records are the table's own; Details hears of them by command,
  the VS Code way. `RenderedWidget` / `WidgetContext` keep only what every widget with data has; `records`,
  `onDidChangeRecords`, `selectRecords` and "selecting records makes a widget active" go. The table keeps its ticked
  rows in its renderer and runs `details.showRecords` with them and the widget on each change (and when a new answer
  or its removal clears them); Details keeps what it was given, shows it, counts it in the status bar and pops it out
  (D14). Neither extension imports the other (§3.4.5).
- **D20 The click's filter UI by command (9f, decided after 9e):** the quick pick "Filter" leaves the `widgets` host
  for the `filters` extension, the VS Code way. Each place that offers filters on a click (the Plot charts'
  `filterOnClick`, the table's cell click, the Explore view's group rows) runs `commands.executeCommand('filters.offer',
  at, candidates, { dataUrl, filterable })` itself; `filterOnClick` only finds the candidates under the pointer. The
  `filters` extension registers `filters.offer` and owns the picks, `OP_ICONS`, `fetchPill` and the `/pill` call; it
  adds the pill to the active tab's query state (a click happens in the tab shown). `WidgetsApi.offerFilters`,
  `WidgetContext.offerFilters` go; `PillSource` / `FilterCandidate` stay as the types of what a widget offers (in the
`widgets` host until 9ad, since then in `filter-library`, D38). Without
  the `filters` extension a click does nothing.
- **D21 A pill's key is read by the filters extension (9g, decided after 9f):** `pillLabel`, `pillButton`,
  `pillField` and `PillField` (the decoding of the key's payload) leave the `query` host for the `filters` extension,
  which draws the chips (`extensions/filters/pill-key.ts`). The `query` host keeps a chip as an opaque value,
  `{kind: 'pill', key}` or `{kind: 'sql', sql}`, and only writes it to and reads it from the URL (`f`, `sql`); it
  stores and derives no label (`Pill` is `{key}`; `fetchPill` and a button's pill give the key only, the label the
  server answers beside it is not kept).
- **D22 The chart frame and the shared helpers into extension libraries (9h, decided after 9g):** `ChartFrame`
  leaves the `widgets` host for `extensions/chart-library/chart-frame.ts` (beside `filterOnClick` and `drawTable`);
  the host keeps rendering widgets, the active widget and its status. The small helpers move out of the hosts by
  their users: `widgetTitle` (Debug, Details, the Explore view) to `extensions/widget-library/widget-title.ts`,
  `formatTime` (the time picker, `ChartFrame`'s dragged range) to `extensions/time-library/format-time.ts`
  *(proposed)*. `showWidgetError` stays in the `widgets` host, unexported: only the host shows an error in place
  of a widget (a type without renderer, a renderer that throws) *(proposed)*.
- **D23 Layout fix of D5 (9i, decided after 9h):** the left rail and the left side panel go full height, from the
  window's top to the status bar; the tab row (tabs, "+", at its end the funnel (gone since 9o, D26), time range, refresh) sits only above
  the content (`WindowLayout`: the top bar is the centre column's first row); the global "…" moves to the left rail's
  start, above search everywhere; the Dashica icon (home button) goes. The right side is full height as well, the
  same rule on both sides *(proposed)*.
- **D24 Query state registered by key (9j, decided after 9i, "go all the way"; registration replaced by typed keys
  in 9w, D36):** the `query` host becomes a plain
  per-tab URL state store without keys of its own (`registerState`, §3.7); `time-range` owns `time` / `range`
  (`TimeModel` leaves the host), `filters` owns `f` / `sql` (`FiltersModel` leaves it), `refresh` owns `refresh` and
  the auto refresh timer, paused for a background tab and a hidden window (`QueryHost.setShown` and the host's timer
  go), `dashboardPage` owns `wp` (`ParamsModel` leaves it). Readers take a state by its id or `requestParams`, never
  by importing another extension. The server's URL format stays; no Go change. Specs shared by several extensions
  live in libraries (`time-library`, `widget-library`) *(proposed)*; the filter chips' spec stays in the `filters`
  extension, and a table cell adds its SQL chip by the command `filters.addSql` *(proposed)*. A form widget without
  the `params` state (no `dashboardPage`) shows "No extension keeps the page params" as its error *(proposed)*.
- **D25 Pill ops by the field's type (9k, decided after 9j; maintainer: "timestamp filters usually need no = or !=
  but <= >= etc."):** the ops are `eq`, `ne`, `lt`, `le`, `gt`, `ge` (`sql.Op`), signed as before. Which ones a field
  offers depends on its ClickHouse type: text (a String, an Enum, a Bool, an unknown type) `=` and `≠`; a number also
  `<`, `≤`, `>`, `≥`; a time or a day `≥` and `≤` first (`opsOf`). The type comes from the server, never guessed:
  `<dataUrl>/values` answers `{type, values}`, the type as ClickHouse reports it in the answer's metadata; "Add filter"
  asks the type alone (`<dataUrl>/type`, since 9l) once the field is chosen, before the op. A time's value is no list of DISTINCT timestamps but an input box,
  the edge of the time range filled in, read by ClickHouse best effort. A click on a table's timestamp cell or a
  chart's time value offers `≥` and `≤` it (beside `=` / `≠`); the table cell menu's time windows (±5 minutes …) stay.
  A pill's op button opens a quick pick of its type's ops (a menu since 9s, D30). `FilterAs(func(op sql.Op, value string) string)`; the
  default condition `(<expression>) <op> <quoted value>`.
- **D26 No funnel; a SQL condition from "Add filter" (9o, decided 2026-10-31):** the funnel button in the top bar
  (next to the time range), which added a SQL chip, goes. "Add filter"'s first quick pick (the tables, or the fields
  of a page with one table) ends with "SQL condition…" under the heading "Advanced", only while `filters.sqlEnabled` is
  on; it asks the condition in an input box (`showInputBox`) and adds it as a SQL chip. Editing an existing SQL chip
  stays in the filter bar (its textarea; since 9aa the same SQL input box below the chip), also only with the flag on.
  *(proposed)* With the flag on, "Add filter" shows on every page with `filterBar`, and with it the filter bar, also
  without a filterable chart (then "SQL condition…" is its only entry), so that a SQL chip can be added on any such
  page; the input box is one line (no Shift+Enter, as the chip's textarea has; since 9aa both are the SQL editor, which
  has Shift+Enter).
- **D27 Table columns and computed fields; no constants (9p, decided 2026-10-31; maintainer, on "Add filter"'s field
  list of `mv_oekokiste_shop` with `'darkred'`, `orange` and `darkorange` in it: "missing fields from schema of
  table… maybe this needs grouping like 'table fields' and 'computed fields' … and static things like 'darkred' should
  never appear here"):**
  - **A constant never filters:** a field whose definition is a lone SQL string or number literal (`'darkred'`,
    `'#D73027'`, `42`; a fixed colour of a Fill) holds no categories (`sql.IsCategory`), so it is in no `filterable`,
    neither in "Add filter" nor in a click's quick pick, and `/pill` answers 422. So is a SQL file's or string's
    column it selects as a literal (`'darkred' AS color`, `sql.IsConstantColumn`, which reads the text with a regular
    expression rather than parsing it *(proposed)*; a literal in any of its SELECTs counts *(proposed)*).
  - **The field step in two groups:** "Table columns", every column of the table as the server's cached schema of
    the chart's connection has it (the Schema view's `Client.Schema`, D11), with its type, from
    `<dataUrl>/columns` (`{columns: [{name, type, …}]}`, the resolved time range in its header for a time's default;
    not behind `explore.enabled`: it is only the chart's own table), asked of the table's first chart; then
    "Computed fields", the charts' fields that are more than a column, each alias once. `page.json` names them per
    chart (`computed` beside `filterable`): an expression, a `FilterAs`, a renamed column (`sql.Field("customer_project").WithAlias("instance")`) and every field of a SQL file
    (a column of its result, not of the table) *(proposed)*; a builder query's field that is just a column
    (`sql.ColumnOf`) appears once, under the columns. Without the schema (a failed `/columns`, its message beside
    the heading) the columns are the charts' plain fields, each made by its chart *(proposed)*.
  - **A column's pill is signed by the server too:** `<dataUrl>/pill?column=<name>&…` (and `/values`, `/type`) takes
    a column of the chart's base table, checked against the cached schema (never the client's word), its name quoted
    as an identifier (`sql.QuoteIdentifier`, `` (`host`) = 'shop-1' ``, `sql.ColumnField`); 422 for a column the table
    lacks. The ops of D25 come from the column's type in the schema (the client asks no `/type` for it; the key's
    `type` was the schema's, not the client's, until 9q). The key carries `column: true` *(proposed: a separate parameter and
    flag, so a computed field and a column of the same name never mix up; since 9q a key without a condition, D29)*, so the filter bar edits it through any
    chart on its table (the table's first one), else it is only removed ("No chart of this page reads …"). A
    column's values come from the chart's query when it is a builder query (its From and Where), else from the table
    itself (`SELECT … FROM <table>` with the time range and pills), as a SQL file's result need not have the column
    *(proposed)*. A table missing from the schema is taken as `default.<name>` when its name has no database
    *(proposed)*.
  - **The node names its table** whenever its query has one and takes filters, also without filterable fields (a
    stats or a time line), so "Add filter" offers the columns of every table the page reads *(proposed)*.
- **D28 A chart that ignores filters is drawn muted (9r, decided 2026-10-31; maintainer: "maybe the charts which have
  'ignores ...' anything should be a bit greyed out or the like, so one sees visually that the filter does not apply
  here"):** while a chart's last answer ignores at least one of the page's filters (its "ignores host, path" badge
  shows), `ChartFrame` puts `d-chart-frame--muted` on its frame: its stage (the drawing, not the title row) at
  `--opacity-muted` and `saturate(--saturation-muted)` (tokens, the same on both schemes), the badge at full
  strength. The pointer on it, the focus in it or it being its tab's active widget (`d-widget--active`) draws it at
  full strength again. A skipped chart ("skipped: …") and a failed query are drawn as before, unmuted. Since 9af (D38)
  the muted look is driven by the widget's decorations: the `filters` extension's "ignores <label>" ones say `muted`,
  and `ChartFrame` mutes while any decoration does.
- **D29 A readable, short pill key (9q, decided 2026-10-31; maintainer: the signed key in `f` is "far too long",
  ~330 characters):** still signed, still in `f` (repeatable), now `<table>.<field><op><value>[~<condition>]~<mac>`
  (`filter.Sign`, `filter.Open`):
  - **The table** is `[<connection>:][<database>.]<name>`: the connection left out when it is `default`, the database
    when it is the connection's from `dashica_config` (`filter.ShortName`), e.g. `logs:full_logs` on Solarwatt's
    `monitoring` connection, `system.one` on `default` *(proposed: `:` after the connection)*. `page.json`'s `table`
    names a chart's table the same way, so the client matches a key's table to the page's charts as it is.
  - **The op** is its ClickHouse operator: `=`, `!=`, `<`, `<=`, `>`, `>=` (`sql.Op.Operator`).
  - **The condition** is carried only when it is not the column's own, `` (`<field>`) <op> <quoted value> ``
    (`sql.ColumnField`); `Open` writes that one for a key without. A key without a condition is a column's pill
    (`Pill.Column`, before a flag in the payload). A click on a builder field that is just a column (`sql.ColumnOf`:
    `sql.Field("host")`) makes that column's pill, `` (`host`) = 'web-1' ``, as "Add filter" does, so its key is the
    short one too *(proposed)*; an expression or a `FilterAs` carries its condition.
  - **A button's key** is `@<queryPart>[~<value>]~<mac>` (`@duration_ms >= ...~500~…`): its `queryPart` as text,
    not its index, as a button's pill applies on every page and an index is only the defining page's *(proposed)*;
    `Open` writes its condition again (`NewButton`). Its label is its condition: the title is not in the key, so a
    button's chip on a page without that button shows `duration_ms >= ...: 500` *(proposed)*.
  - **No label and no type:** the chip shows `field op value`. The field's type (D25's ops of a pill's edit) is asked
    of the editing chart (`<dataUrl>/type`) when its operator or value is clicked; `/pill` takes no `type` any more
    *(proposed: the format has no place for it, one request per edit)*.
  - **The mac** is HMAC-SHA256 over everything before it (without its `~`), its first 128 bits, unpadded base64url:
    22 characters.
  - **Unambiguous with any text:** `%` and the separators a part could hold are percent-encoded in it (`~` in every
    part; `:`, `.`, `=`, `!`, `<`, `>` and `@` in a connection, database, table or field name; a value's leading `=`,
    so `<` with `=5` is not `<=` with `5`), read back with `url.PathUnescape` / `decodeURIComponent`. The URL encodes
    the key again on top (`URLSearchParams`).
  - **Old keys stop working** (a 400, as an unsigned key), no migration.
- **D32 The Schema view's views (9x, decided 2026-10-31):** (1) "Show comments", a toggled entry of the panel's "…"
  (`schema.toggleComments`, `MenuItem.toggled`), shows or hides the columns' and the tables' comments, on by default,
  kept in the extension's `globalState`; (2) "On this page" lists exactly the tables the shown page's charts read
  (`page.json`'s `table` and `connection` of each chart), still as connection › database › table, and follows the page
  shown; (3) "On this page" and "All connections" (was "Other connections"; now every connection) are views
  (`createView`, as Debug's), whether one is closed kept in `globalState`. *(proposed)* `/schema.json` answers the
  connection's own `database` (dashica_config's, required), so a `table` without database (`filter.ShortName`) is
  found in it; "On this page" asks the page's connections while the panel shows and draws them open down to the
  tables (a table closed); a table the schema lacks shows as "<name>: not in the schema."; the comments are hidden by
  CSS (`d-schema--no-comments`), so nothing opened closes; the schema is asked once per connection and shared by both
  views (`Schemas`).
- **D33 A popped-out view's tab without the filter bar (9y, decided 2026-10-31; maintainer: "in the Debug pop-out, do
  not display the filter top bar (does not make any sense in this context)"):** a tab showing a popped-out view (§3.4.6:
  Debug, the Details comparison, Speedscope) has no filter bar, decided by the workbench for every popped view, not
  per extension. *(proposed)* The top bar's time range and auto refresh are hidden there too (they change nothing a
  popped view shows); the step's id is 9y, as 9t was taken by D31.
- **D34 Free text in headers percent-encoded (9u, decided 2026-10-31):** a header Dashica writes with free text
  (`X-Dashica-Diagnostics`, `X-Dashica-Column-Types`) is its JSON through Go's `url.PathEscape`; every reader runs
  `decodeURIComponent` before `JSON.parse` (`fetchQueryResult` in the `widgets` host, `fetchRows` in `explore-view`).
  The hand-written `\u` escaping (`util.ASCIIJSON`) is gone. The other headers carry numbers only (time range, bucket
  size, rows limit, an alert's thresholds) and stay plain JSON.
- **D35 The config injected, not copied flags (9v, decided 2026-10-31; maintainer: "the handler needs access to the
  config; it can then check at the various positions whether SQL is allowed and throw otherwise"):**
  `rendering.Dependencies` carries the loaded config instead of `ExploreEnabled`, `FilterSecret` and `SqlEnabled`;
  `ParseQueryState(r)` only reads the request; the SQL-chip check sits where a chip enters a query. A middleware and a
  request-reading service in the dependencies were rejected.
- **D36 Typed query keys (9w, decided 2026-10-31; maintainer: `this.#ctx.state.state<TimeRange>(TIME_STATE)?.set(...)`
  "is too complicated"):** a key carries its URL format, `export const TIME = queryKey<TimeRange>('time', { parse,
  format, sentToServer: true })`, defined once where the state belongs; readers and writers use `query.get(TIME)`,
  `query.set(TIME, value)`, `query.onDidChange(TIME, listener)`, typed by the key, never `undefined`; a key used for the
  first time is known to the host from the key itself. The widget context's query state is `ctx.query`. Gone:
  `registerState`, `state<T>(id)`, string state ids, the dispose of registrations. Ownership is who defines the key
  (§3.7). *(proposed)* The data fetch that was `ctx.query()` is `ctx.runQuery()`, as `ctx.query` is now the query
  state; `queryKey`'s first argument is the URL key or keys (`['time', 'range']`); `sentToServer` is `true` (its URL
  entries) or a function (`TIME`'s own entries, sent also when it is the default, since the server needs a time range
  and does not know the page's); the form widgets' "No extension keeps the page params" error is gone, as `PARAMS` is
  always there; `dashboardPage` no longer touches `wp`.
- **D37 The input box validates as typst-experiment's (9z, decided 2026-10-31):** `InputBoxOptions` gets
  `valueSelection` (the part of `value` selected at first, else all of it) and `validateInput(value)`, as VS Code's:
  run when the box shows, on each keystroke and on Enter, its answer shown below the field; a text or an `Error`
  message (`InputBoxValidationSeverity`) blocks Enter, an `Info` message only tells. That `Info` message is the prompt
  that follows the typed value (no second option). A filter button with `...` uses it: the box is named after the
  button, its placeholder the button's `queryPart`, and below the field shows the raw condition the value makes
  (`buttonCondition`: each `...` replaced by the value as `sql.Quote` writes it, e.g.
  `event_original.username ILIKE concat('%', 'acme', '%')`) — the preview only, the page still makes the signed key;
  an empty value is refused ("Enter a value."); a new value for a pressed button starts with the current one filled in
  and selected. *(proposed)* `validateInput` is synchronous (nothing asks the server while typing) and the severities
  are VS Code's `Info` and `Error` only (no `Warning`); the box's title stays its accessible name, not a visible line;
  the step's id is 9z, as 9x was taken by D32.
- **D38 The hosts know nothing about filtering; widget decorations (9ad–9ag, decided 2026-11-01; maintainer: "why is
  FilterCandidate part of the widget host? can't the full filtering concept be part of an extension?", then "the
  ignores… badge, the muted chart, Debug => isn't this some generic chart notification extension point?" — answered
  with VS Code's `window.registerFileDecorationProvider` / `FileDecoration {badge, tooltip, color}`: "widgetDecoration
  good!!! yes", and for the headers "do that. alert things exactly"):** in four steps, each its own commit.
  (9ad) `filters.offer`'s argument types belong to its side: `FilterCandidate`, `PillSource`, `OfferFilters` and
  `offerFiltersOf` (until then in `hosts/widgets/widgets.ts` and `chart-library/filter-on-click.ts`) move into
  `frontend/extensions/filter-library/offer.ts`, with the command's id `OFFER`; the chart tests record the command
  through `chart-library/offer-testing.ts` (`recordOffers(commands)`), the widgets host's testbed knows no filter
  command *(proposed: that part of (9ag) in 9ad, since the testbed is in `hosts/` and may not import the library)*.
  (9ae) The widgets host passes the response headers through without reading them (`QueryResult.headers`); each header
  is read by its user through a pure function next to it. (9af) Widget decorations as VS Code's file decorations: the
  `filters` extension decorates a chart that ignores pills or did not run; `ChartFrame` and Debug draw decorations
  without knowing their meaning. (9ag) What is left of filters, alerts and charts in `hosts/` goes.
- **D30 A menu mode of the quick input (9s, decided 2026-10-31; maintainer, on the global "…" showing a quick pick with
  an empty search field: "a menu one would expect usually has no search bar, and the opener (the three dots) stays
  open/active until the menu is dismissed. Still I think this could be built inside the quick pick"):** one quick
  input, an option `menu` (`QuickPickOptions.menu`, `QuickPick.menu`), not a second widget. A menu opens as a plain
  list (box `d-workbench__quick-pick--menu`): its field is out of sight (`d-workbench__quick-pick-field--concealed`)
  but keeps the focus, so the arrow keys and Enter work at once; a first letter typed makes the first entry whose
  label starts with it active, a second one shows the field in place and from then on the text narrows as usual
  (`onDidChangeValue` fires once the field shows). The element a menu is anchored at, its opener, is
  `aria-expanded="true"` while the menu is open and `"false"` once it is dismissed or an entry chosen, and tinted
  (`--color-accent-subtle` / `--color-accent`, as a pressed button) by one rule in `quick-input.css` for any button
  with `aria-haspopup`. Menus: every registered one through `showContextMenu` (the global "…", the panel headers'
  "…", the chart's "…", the dashboards entries' "…", a table's cell and header menus, Debug's), a click's ⊕ / ⊖ offer
  (`filters.offer`), Explore's Reset confirmation. Pickers keep the field: "Add filter"'s table, field and value
  steps, "Start from chart…", search everywhere. *(proposed)* A pill's operator (the filter bar's op button and "Add
  filter"'s op step) is a menu too, a short fixed choice that the maintainer's picker list leaves out; the Reset
  confirmation's question ("Reset the viewer’s config?", its placeholder until 9s) is the menu's heading; a point
  anchor (a right click, a chart click) has no opener to mark.
- **D31 Enablement belongs to the command (9t, decided 2026-10-31; maintainer: "yes, do as vs code"):** as VS Code's
  `contributes.commands[].enablement`, `commands.registerCommand(id, handler, { enablement?: () => boolean,
  disabledReason?: string })`, read by `commands.enablement(id)` (`{ enabled, disabledReason }`, the reason only while
  not enabled). Every place that shows or triggers a command asks it: a menu draws a disabled command greyed
  (`QuickPickItem.disabled` stays the quick input's generic flag, set by `ContextMenu` from the command) with
  `disabledReason` on hover; its keybinding does nothing; rail buttons and search everywhere's command list show it
  greyed. `executeCommand` from code ignores enablement, as VS Code's. `MenuItem.enabled` and `MenuItem.tooltip` are
  gone; a menu entry keeps `when` (shown or not) and `toggled`. Migrated: Explore off registers `exploreView.open`
  never enabled (`EXPLORE_NOT_ENABLED`, now the command's options) with the reason "Explore is not enabled
  (explore.enabled)"; "Start from chart…" (`exploreView.startFromChart`), Details' and Debug's "Pop out"
  (`details.popOut`, `debug.popOut`). *(proposed)* The hover of an enabled entry is gone with `MenuItem.tooltip`
  (the descriptions of "Explore", "Start from chart…" and the pop-outs; VS Code's menus have none either); the new
  reasons are "The shown page has no chart", "No records selected" and "No active chart" (Debug's status bar text);
  a key of a disabled command is not prevented, so the next binding or the content gets it (VS Code skips such a
  binding); a rail button asks the enablement when it is added and whenever its tooltip may show (pointer enters,
  focus) and on a click, as there is no change event (VS Code's context keys have one), and shows greyed by
  `aria-disabled` (`--opacity-muted`), its tooltip "<label>: <reason>"; the step's id is 9t, as 9r was taken by D28.

✅ **Built in 9k (2026-10-31): the ops by type**, with these details and deviations:

- **Go:** `sql.Op` (`Valid`, `Sign` for the label: `=` `≠` `<` `≤` `>` `≥`, `Compare(expression, value)`: `expression
  >= 'value'`), `sql.Condition(field, op, value)`, `FilterAs(func(op sql.Op, value string) string)` *(proposed: the op
  as a parameter, the outer dashboards' ten `FilterAs` written as `op.Compare("<expression>", value)`)*; `filter.New(table,
  field, op, value, type)`, the label `<alias> <sign> <value>`; `Apply` ORs only the `eq` pills of a field, every other
  op's are AND-ed *(proposed: `ts ≥ a` and `ts ≥ b` both hold)*.
- **The type in the key (until 9q; since then the key carries no type and the filter bar asks the chart's `/type`
  when a pill is edited, §3.15 D29):** `Pill.Type` (`type`, omitted when empty) is the field's ClickHouse type as the client
  learned it from the server, sent to `/pill` as `type` and signed into the key, so a reloaded pill's op button offers
  its type's ops without a query *(proposed: the server never reads it as SQL and does not check it against the op;
  any op is valid SQL on any field)*. A pill without one (a link from before 9k, a click on a column the answer named
  no type of) offers `=` and `≠`.
- **`/values`** answers `{type, values}`: `sql.Values` also selects `any(<definition>) AS __type`, whose type in the
  JSON answer's `meta` is the expression's (also with no rows) *(proposed)*; the answer carries the resolved time
  range (`X-Dashica-Resolved-Time-Range`, as a chart's) for the input box's default. Until 9l "Add filter" asked
  `/values` before the op and reused its values for the value step; since 9l it asks `/type` before the op (no values
  read), and `/values` only in the value step of a field that is no time or day.
- **A click's type:** a chart's Arrow answer names its columns' ClickHouse types in `X-Dashica-Column-Types` (`{"timestamp":
  "DateTime"}`, JSON, since 9u percent-encoded as `X-Dashica-Diagnostics`), taken from the `DESCRIBE` that `ensureArrowCompatible` runs for every Arrow query anyway,
  before the casts (a `DateTime` arrives as UInt32 seconds) *(proposed: no extra query; the header is the
  `clickhouse` client's; `util.ASCIIJSON`, moved out of `httpserver` for it, went with 9u)*; read by `columnTypesOf(result)`
  (`chart-library/candidate.ts`, since 9ae; until then `QueryResult.dashicaColumnTypes`);
  `chart-library/candidate.ts` `candidateOf` gives each candidate its type and writes a time as ISO 8601 in UTC
  (`2026-10-31T10:00:00.000Z`), a day as `2026-10-31` (`widget-library/clickhouse-type.ts`: `typeKind`, `pillValue`,
  by the unit Arrow carries: `DateTime` seconds, `Date` days, `DateTime64` / `Date32` ms; since 9m a `DateTime64(4…9)`
  with its µs, read from the ms fraction apache-arrow gives a Timestamp in µs or ns, to the µs, since a JS number
  carries no ns *(proposed)*). The quick pick shows per
  candidate one entry per op of its type: `=` with the filter icon, `=` with the minus icon (Exclude, as D4), the range
  ops with their sign and a chevron.
- **Time buckets stay without pills** *(proposed)*: a time bar's x (`AutoBucket`, `Timestamp15Min`) still cannot filter
  (422, D6), since `=` on a bucket means nothing and the bucket's expression depends on the range; "a chart's time
  value" is a plain time field (`sql.Field("timestamp")`, `toDate(timestamp)`), as a table's timestamp column is. The
  drag on a time chart sets the time range.
- **The value of a time:** an input box (`askValue`, `showInputBox`): "Add filter" fills in the time range's start for
  `≥`, `>`, `=`, `≠` and its end for `≤`, `<` (now without a range), as ISO 8601 in UTC, a day as its date; editing a
  pill's value fills in its value. The text goes to `/pill` as typed, a quoted literal; ClickHouse parses it (the data
  handlers set `date_time_input_format=best_effort`) *(proposed: no parsing in the browser)*.
- **The op button** of an editable pill opens a quick pick below it of its type's ops, the current one checked; a
  pick asks `/pill` again and replaces the chip in place, as the value does.
- **To check against ClickHouse** (written, not run: the sandbox blocks it): `TestHandleQuery_AnISOTimeComparesADateTimeColumn`
  (`timestamp >= '<ISO with Z>'` against a `DateTime`, whether best effort applies to a literal compared with a
  column), `TestHandleValues_TheValuesOfAFieldThatContainTheSearch` (the type `UInt16` from the metadata). A number
  compared with a quoted value needs the same check as the buttons' (`status >= '1000'`, 9b).
- **Tests:** Go `sql` (`Op`, `Condition` per op, `FilterAs` with the op, `Values` with `__type`), `filter` (`New` with
  a range op and the type, the key back through `Open`, `Apply`'s groups per op), `widget` (`/pill` with `ge` and
  `type`), `clickhouse` (`columnTypesHeader`); vitest: `typeKind` / `pillValue`, `opsOf`, `candidateOf`, the table's
  timestamp cell, the widgets host's column types, `offerFilters` (a time's ops, the type sent), `pillField` (a range
  op and its type), "Add filter" (one `/values` before the op, a time's ops and its input box at the range's edge,
  `askValue`, `fetchValues`'s `{type, values, timeRange}`), the filter bar (the op's quick pick, a time's value in an
  input box with its value). Playwright: `e2e/filter-chips.spec.ts` picks the op in the quick pick (written, not run).

✅ **Built in 9a (2026-10-31): `filters.sqlEnabled`**, with these details and deviations:

- **The flag** is `config.FiltersConfig.SqlEnabled` (`filters.sqlEnabled` in `dashica_config`, or
  `FILTERS__SQLENABLED=true`: the env provider lowercases the key, and the decoding matches it regardless of case).
  *(proposed)* Not both: the file's camel-case key and the environment's lowercase one are two keys to `koanf`, and
  the file's wins; the checked-in `*-production.yaml` therefore only name it in a comment. The local configs of
  `mise run generate-config` turn it on, so the e2e specs with SQL chips keep running. The handlers read it from the
  config injected as `rendering.Dependencies.Config` (since 9v; in 9a a copied `Dependencies.SqlEnabled`),
  `workbench.json`'s `sqlEnabled` carries it to the client.
- **Checked where a SQL chip enters a query** (since 9v, D35; in 9a in `ParseQueryState(r, sqlEnabled)`, so also
  the handlers that never apply one refused it): `QueryState.SqlClause(timeRange, cfg.Filters)` answers a non-empty
  `sql` with `ErrSqlNotEnabled` (a `QueryStateError`, so 400: "SQL filters are not enabled (filters.sqlEnabled)")
  while it is off; an empty `sql` is no chip. So a chart's `/query`, `/debug`, `/rows`, `/sql`, `/values` and `/type`
  (`QueryHandler.prepare`) and Speedscope refuse it before any query; `/time-range` and the alert widgets, which
  apply no SQL chip, take it. Speedscope's handler answers a query state it cannot read with 400 (`httpError`), not
  500.
- **Handlers get the config injected; no copied flags** (9v, D35): `rendering.Dependencies.Config` is the loaded
  `*config.Config`, read only, nothing request-specific; the handlers outside `Dependencies` have it as a field
  (`QueryHandler`, `SchemaHandler`, `ConnectionRowsHandler`; `TimeRangeHandler` needs none). Each checks the setting
  where it applies: `explore.enabled` in the Explore handlers, `filters.sqlEnabled` in `SqlClause`, `filters.secret`
  where pills are signed and opened.
- **The client:** without `sqlEnabled` the filter bar has no funnel (since 9o no "SQL condition…" in "Add filter", D26), a SQL chip of a link is not edited (only ×; its
  tooltip says "SQL filters are not enabled (filters.sqlEnabled)"), and the table's cell menu has no SQL entries
  ("Filter: Contains this value", the time windows). The filter buttons still added SQL chips until D17, so
  while the flag was off a pressed button failed the charts with 400 *(proposed: for one step)*; since 9b they add
  signed pills and work with the flag off.
- **Tests:** Go `config` (the flag from the file and from the environment), `httpserver` (`SqlClause` off and on, an
  empty `sql`; `/time-range` takes a chip, since 9v), `widget` (every data endpoint of a chart and Speedscope 400 off,
  past the check on),
  `dashica` (`workbench.json` says it); vitest: the filter bar off (no funnel, since 9o no "SQL condition…", a SQL chip not edited, pills and "Add
  filter" stay), the table's cell menu off.

✅ **Built in 9b (2026-10-31): the filter buttons signed**, with these details and deviations:

- **A button's pill** is a `filter.Pill` without table, field or op, made by `filter.NewButton(title, queryPart,
  value)`: its condition the `queryPart`, each `...` replaced by `sql.Quote(value)`; its label the title, with
  `: <value>` for a `...` button; `Button` (the `queryPart`) and `Value` (as typed) in the signed key, by which the
  page finds the button again (`pillButton`, `buttonOf`) *(proposed: one key format and one URL key `f` for pills
  and buttons; the button found by its `queryPart`, so the same button on two pages is one, and a key from another
  page never presses a button that only shares its index)*. `filter.Open` takes a key without op when it has `Button`.
- **`page.json`** (`dashboard.pageButtons`): a button without `...` carries `key`, its pill signed at registration
  (a page with buttons needs `filters.secret` to register); one with `...` carries `url`
  (`<page>/button?i=<index>`), which the client asks with `&value=`. `queryPart` stays, as the button's tooltip and
  its identity *(proposed)*.
- **`<page>/button`** (`dashboard.buttonHandler`): `{key, label}`; 404 for no such button, 400 for a button without
  `...` or an empty value.
- **Applied** by `filter.Apply` to every query that does not skip filters, a SQL file without `sql.Table` too, each
  one Where after those of the fields; a query that skips filters names it in its Diagnostics as ignored
  *(proposed: as it does a pill)*. Speedscope's query now opens and applies the pills too (`serveSpeedscope`), so a
  button filters it as a SQL chip did *(proposed: also the pills on its table)*.
- **The `...` inside quotes goes:** the value is a whole literal now, so the dashboards write `request__host = ...`,
  `path ILIKE concat(..., '%')`, `event_original::String ILIKE concat('%', ..., '%')`; `literalOf` and the client's
  matching of a SQL chip against a `queryPart` are gone, and a `?sql=` with a button's condition is a plain SQL chip.
- **A number column against the quoted value** (`duration_ms >= '500'`): the existing ClickHouse test
  `TestHandleQuery_AQuotedValueMatchesAUInt16Column` shows `=` converts the literal to the column's type; the new
  `TestHandleQuery_AButtonsQuotedValueComparesAUInt16ColumnAsANumber` checks `>=` (`status >= '1000'` matches neither
  200 nor 500; as text it would match both). **Open:** written, not run (the sandbox blocks ClickHouse).
- **The client:** pressing a button without `...` adds `{key, label: title}`; one with asks the value
  (`showInputBox` below the button) and adds the page's answer; a pressed `...` button is a group of its title
  (releases it) and a button per value (`d-filter-button__value`: asks a new value, the old one filled in and selected, and
  `replace`s that chip at its index, unless the chips changed meanwhile). A refused value is logged, nothing added.
  The buttons work with `filters.sqlEnabled` off.
- **Tests:** Go `filter` (`NewButton`, its key back through `Open`, `Apply` to a table, another one, a SQL file
  without table, after the fields, ignored when skipping filters), `dashboard` (`page.json`'s `key` and `url`,
  `/button`'s pill and refusals), `widget` (a button's pill on a SQL file without table and another table, a tampered
  pill 400 on Speedscope), the golden contract with a `...` button; vitest: `pillButton`, `buttonOf`, a button's
  pill pressed and released, a `...` button's value fetched, shown and replaced in place, a refused value, a button
  with SQL chips off; `e2e/filter-chips.spec.ts` (the button's `f`, a `...` button's value and its change).

✅ **Built in 9c (2026-10-31): the pills editable**, with these details and deviations:

- **The key:** a field's pill carries its shown value as `Value` (`filter.New`), beside `Table` and `Field` (the
  alias), all signed, so a changed value is refused as a changed condition is *(proposed: the one `Value` of the
  buttons' pills, for a field's pill the value shown, for a button's the value written in)*. `/pill`, `/values` and
  `Apply` are unchanged.
- **The client:** `pillField(key)` reads `{connection, table, field, op, value}` from the payload (since 9q from the
  readable key, §3.15 D29) (`undefined` for a
  button's pill, a key without a field, and one without `value`: a pill signed before 9c, which cannot be made again,
  so it is only removable, its tooltip its label *(proposed)*; `Value` has no `omitempty`, so an empty value is in
  the key as `""`, 9c fix); `fieldSource(tables, field)` is the first chart of the page's
  `filterableTables` with that connection, table and field. A pill with one shows as its field, its operator and its
  value, the last two buttons: the operator asks the chart's `/pill` for the other op with the same value (since 9k
  it opens a quick pick of the ops of the pill's type, §3.15 D25), the value
  opens `pickValue` (the quick pick of "Add filter", the chart's lazy `/values`, the typed text offered; since 9k an
  input box for a time) below it and
  asks `/pill` with the same op. The answer `replace`s the chip at its index, so it keeps its place among the others; an answer that is
  another chip already (`host = a` switched beside a `host ≠ a`, a `...` button's value changed to one it has)
  removes the chip edited instead, so `f` never holds a key twice (9c fix);
  pills combined on one field stay chips of their own, each edited alone. An empty value shows "(empty)", as the
  quick pick does *(proposed: so it can be clicked)*; the quick pick starts empty, not with the value *(proposed: as
  "Add filter")*.
- **Not editable:** a pill no chart of the page makes (no `fieldSource`: another page's table, a field the page does
  not show) is its label and ×, its tooltip "No chart of this page filters <table> by <field>, so it can only be
  removed"; a button's pill outside its page stays as 9b left it.
- **Refused or late:** a refused `/pill` is logged and the chip kept; an answer that comes back after another chip
  took the place (`chips[index]` is no longer the chip edited) is dropped *(proposed)*.
- **Tests:** Go `filter` (`New` carries the value; a changed value in a key is refused), `widget` (`/pill`'s key
  with field and value); vitest: `pillField`, `fieldSource`, the filter bar (the parts of a field's pill, the operator
  switched and the value changed in place via `/values` and `/pill`, nothing on cancel, a refusal or a chip changed
  meanwhile, one no chart makes only removed with its tooltip); Playwright (written, not run):
  `e2e/filter-chips.spec.ts` (operator and value edited in place on the page whose charts sign the pills),
  `e2e/add-filter.spec.ts` (an empty value's chip shows "(empty)").

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
| Filters as raw expressions in the URL | client-sent SQL everywhere; blocks permissions later (§6); ids + bound values cost little. From 8e the URL carries conditions, but only ones the server wrote and signed (§3.8) |
| `additional_table_filters` (as Grafana's ClickHouse plugin) | ClickHouse applies it at every read of the table, also in subqueries where a filter must not apply; complex queries need to say *where* filters go, hence `{{DASHICA_FILTERS}}` |
| Parsing queries (SQL AST) | not needed: a chart knows its own fields and its base table (from 8e: the field writes its condition, a SQL file names its table by `sql.Table`); ClickHouse's JSON AST (`clickhouse_json` dialect) is unverified as released and would tie us to ClickHouse |
| Drop non-applicable filters silently / fail the chart | silent is misleading; failing hides useful data. The chart's Diagnostics + badge instead (§3.8) |
| A page-wide registry of filter fields (collected at mount, id → expression, a conflict check across charts) | state gathered in a shared object, read per request; template dashboards over several tables give the same alias two expressions. The chart interprets the filters at execution and returns what it did (§3.8) |
| Time range global across pages | Grafana-style per-page default is what dashboards expect; links can still carry `?time=` |
| One page at a time, tabs left to the browser | reversed 2026-10-31: tabs inside the app (§3.4.1), each with its own URL and query state, so the Explore view of a chart and its dashboard stay open side by side |

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
| 6.8 ✅ | the other charts select categories: time bar / time line series (fill, stroke, z), ordinal heatmap rows, `fx` / `fy` facets; table cells select through the same bar (every column, by its name; §7, 8), replacing the cell menu's entries of 6.6; a category field selects by its alias, never a measure or a time bucket; reworked 2026-10-31: the mark `selectOnClick` and a menu of candidates (`ctx.choose`, `ui.showChoices`), no legend | click-to-filter everywhere |
| 6.9 ✅ | props carry aliases (§3.13, 3): client `SqlField` slots go out as `{kind, alias, xBucketSizeMs?}`, never the definition; generator, TS types and fixtures regenerated | dashboards; no expression in `page.json` |
| 6a ✅ | small, any time after 5b.9: queries stop with their client (§3.7), auto refresh pauses in a hidden tab, chart titles in search everywhere and chart links (§3.11) | |
| 7a ✅ | **tab bar** (§3.4.1, decided 2026-10-31); in sub-steps, each its own commit; nothing in it imports the Explore view. ✅ 2026-10-31, deviations: the sub-steps were done at once, as one change (split by path from the spike only); vitest and `quality:typecheck` pass, also without `extensions/explore-view` (and `index.ts`, which imports it); the Playwright specs are written but not run | several pages open side by side |
| 7a.1 ✅ | `query` host per tab: state from a given search (`load({ search, defaultTime })`), `onDidChangeSearch` instead of writing `location`, `setShown`; `parseSearch` / `formatSearch` pure; `activeQuery` for extensions; the `page` host still holds one tab and writes its search into the address bar. ✅ Deviations: `QueryHost.holdsState` is gone (the `page` host compares the tab's URL); `formatSearch` gives `?…` or ''; `activeQuery(source)` takes `{ activeQuery, onDidChangeTabs }`, the `PageHost`'s getter `activeQuery` (not part of `PageApi`) | dashboards (refactor only) |
| 7a.2 ✅ | `page` host with tabs: `tabs.ts` (the `Tab` value, open / close / limit 10 / the tab shown after a close, pure); per tab a `QueryHost`, an element, `page.json` and the rendered page; `navigate(url, { newTab })`, `closeTab`; history entries `{ tab }`, `popstate`, hash changes per tab; `PageContext` (`query`, `hash`, `onDidChangeHash`, `close`) and the renderer's `title`; a page kind named in the hash; `widgets.render(el, widget, state)`; `dashboard-page` on `context.hash`. ✅ Deviations: `PageApi.showTab(id)` added (the tab bar and the tab commands show a tab); a `QueryHost` exists for every open tab, also one restored unloaded, but loads (and queries) only when its tab is first shown; a tab renders anew when its hash names another kind *or another value of it* (`#explore=3` → `#explore=4`); each tab's element scrolls itself and its scroll position is put back on a switch (a `hidden` element loses it); a new tab of a URL without `page.json` shows the error in the tab (only `navigate` in the active tab hands it to the browser, and only while that tab is still the active one when the 404 comes); `onDidChangePage` carries `PageJson | undefined` and fires on every switch of tabs; a chart measuring a width of 0 (its tab in the background) keeps what it drew; `WidgetsHost` takes no query state | dashboards; a second tab only through `navigate(…, { newTab })`, not visible yet |
| 7a.3 ✅ | `TabBar` ported from Zwiebelfisch's `EditorTabs`, its region above the filter bar; ×, middle click, `workbench.tabs.close` / `next` / `previous`; a background tab hidden and paused (`setShown`); the selection cleared on a switch. ✅ (`hosts/ui/layout/tab-bar.ts`, wired in `workbench.ts`) Deviations: a tab is a `role=tab` button with its × beside it in one item (a × inside the tab button would nest buttons); the tab commands are declared after the extensions, so search everywhere lists them after the extensions' commands | tabs |
| 7a.4 ✅ | opening: "Open in new tab" in `dashboards/entry`, search everywhere's Cmd / Ctrl+Enter (`SearchItem.accept({ newTab })`); `page.activeTab.url` instead of `location` in `dashboards`, `search-everywhere`, `chart-link`. ✅ Deviations: Cmd / Ctrl+click on an item of search everywhere opens a new tab too; `QuickPick.onDidAccept` gives `{ newTab }` (`QuickPickAccept`) | tabs from the menu and the search |
| 7a.5 ✅ | reload: the tabs in sessionStorage, the background ones restored unloaded; Playwright `e2e/tabs.spec.ts` (open, switch, the address bar, Back, reload, paused refresh). ✅ (key `dashica:workbench:tabs`, the layout's memento) `e2e/tabs.spec.ts` not run | reload keeps the tabs |
| (spike) | `spike/perspective`, rebased onto 7a, in its own commit (`frontend/extensions/explore-view/**`, `e2e/explore-view.spec.ts`, the Perspective doc): the renderer of kind `explore`; "Open in Explore view" is `navigate(<tab's URL>#explore=<id>, { newTab: true })`; "Close" is `context.close()`; its `showOverContent` in `hosts/ui` and its hash-keeping in `query-impl.ts` are dropped (the tab's URL keeps the hash) | the Explore view as a tab |
| 7b ✅ | **SQL filter as a chip** (decided 2026-10-31, §3.8 "The SQL filter is a chip"): one list of chips (`FilterChip`, `FiltersModel.chips` / `replace`, `sql` / `setSql` / `fields` gone); one `?sql=` per SQL chip, chip order kept across `f` and `sql`, a single old `?sql=` one chip; the funnel adds a SQL chip, every chip edited and removed alike; a filter button a toggle, its chip labelled by its title (`buttonOf`); Go `QueryState.Sql []string`, `SqlClause` ANDs each in parentheses. Files: `lib/httpserver/query_state.go`, `time_range.go` (+ tests), `frontend/hosts/query/{query,query-impl,active-query}.ts` (+ tests), `frontend/extensions/filters/*`, `e2e/filter-chips.spec.ts`; no generated file changes. ✅ 2026-10-31 (vitest and Go tests without ClickHouse green; Playwright written, not run), deviations: `FilterChip = FieldFilter \| SqlFilter` (`FieldFilter` has `kind: 'field'`, `SqlFilter` `{kind: 'sql', sql}`); a SQL chip of only spaces is no chip in the URL, in `add` / `replace` and in Go (`TrimSpace`), not only an empty one; the `=` / `≠` of a structured chip flips its op at once (`replace`), in edit mode it flips the edit's op; the funnel is titled "Add a SQL filter" (its label "Filters" kept); filter buttons show only on a page with `filterBar`, as before; a chip of a `...` button is labelled `Title: value` (several `...` joined with `, `), one of a plain button its title alone; pressing a pressed button removes its chips one by one (one refresh each); tests also in `table`, `widgets`, `dashboard-page`, `bar-vertical`. **Open:** a chip can match two buttons (`/p_wetell/app`: "Host = app.wetell.de" and "Host" with `'...'`): both show pressed, the chip is labelled by the first in page order, either releases it | one filter bar of chips; old links open as before |
| 7c ✅ | **views in a panel** (§3.4.2): `createView` (`hosts/ui/views/view.ts`: header button, ArrowLeft / ArrowRight, collapsed state in the owner's memento); the Dashboards panel as views ("Favorites", one per menu group; headings, rules and the guide line gone); favorites moved by a grip (pointer events) and Alt+ArrowUp / Alt+ArrowDown, the order stored in `favorites`; `e2e/dashboards-views.spec.ts`. ✅ 2026-10-31 (vitest green; Playwright written, not run), deviations: a pure helper instead of `panel.registerView` (no `setTitle` / `dispose`: the owner draws the view anew); a view's description shows only while it is closed; headers stick to the panel's top | collapsible groups, favorites in the viewer's order |
| 7c.1 ✅ | **review fix: view ids** (§3.4.2): a view body's id comes from a module counter (`d-view-<n>`) instead of `Math.random()`: deterministic and never colliding. ✅ 2026-10-31 (vitest) | — |
| 7d ✅ | **the start page "/"** (§3.4.3): Go `dashboard.CollectHome` (`/` and `/page.json`, kind `home`), the redirect to `/home` removed; the renderer `home` in `dashboards` (`home-page.ts`: favorites as tiles with their group, a hint while there are none, the groups with their dashboards), redrawn when the favorites change; outer repo: `/home`, its group "Dashica" and `src/root_page.go` removed; `e2e/start-page.spec.ts`. ✅ 2026-10-31 (vitest, Go tests green; Playwright written, not run), deviations: the start page is drawn by the client from `/workbench.json`, its `page.json` carries no menu *(proposed)*; tiles and links only, no star or menu on the start page *(proposed)* | "/" shows the favorites and all dashboards |
| 7d.1 ✅ | **review fix: no query controls on "/"** (§3.4.3): `hasQueries(page)` and `registerBarItemWhile`; the time range, refresh and Debug's status item leave their bars on kind `home`; the start page's `page.json` added to `contract.golden.ts` (`go test . -run TestContract_Golden -update`); `e2e/start-page.spec.ts` checks it. ✅ 2026-10-31 (vitest, typecheck, Go tests without ClickHouse green; Playwright written, not run) | "/" without time picker and "No active chart" |
| 7e ✅ | **the active widget** (§3.4.4): `widgets.active` / `onDidChangeActive` (`WidgetStatus` from `ctx.query()`), per tab, outlined; Debug as a left side panel of views following it, asking `/debug` only while shown; the status bar's item (title, rows, time, error, ignored filters), a click opens Debug; the bottom panel removed; `e2e/active-widget.spec.ts`. ✅ 2026-10-31 (vitest, typecheck, top comments green; Playwright written, not run), deviations: the innermost widget with data becomes active; no `setActive` (the menu button's press activates); the query time is measured in the browser; the status bar always shows ("No active chart"); Debug's Stats view also holds the ClickHouse summary (the old "Clickhouse Summary (Legacy)" section) *(all proposed)* | the active chart in Debug and the status bar |
| 7e.1 ✅ | **review fix: overlapping queries** (§3.4.4): a per-widget count of `query()` calls; only the latest sets the status and `lastResult`, an aborted latest one puts back the last answer's status (not the one seen at its start, which may be an earlier call's `loading`). Before, an aborted query's late rejection put an old "done" over the newer query's `loading`, and Debug asked `/debug` twice. ✅ 2026-10-31 (vitest: two overlapping queries, the first aborted) | a refresh during a load shows "querying…" |
| 7e.2 ✅ | **review fix: Debug and records** (§3.4.4): Debug remembers the status it asked `/debug` for and asks again only for another widget or another status, so ticking rows (which fires `onDidChangeActive`, step 7f) no longer refetches and redraws it (scroll, the Result table, the pipeline graph kept). ✅ 2026-10-31 (vitest) | ticking rows keeps Debug as it is |
| 7f ✅ | **selected records** (§3.4.5): `ctx.selectRecords`, `ActiveWidget.records` (`WidgetRecord`), told by `onDidChangeActive`; the table's ticked rows, its checkbox column only with `selectRecords`, cleared on each draw; the in-table details panel (full screen, close) and its CSS removed; the `details` extension: the left side panel "Details" (a view per record, `renderRecordDetails`' formatting as `drawRecord`), the status bar's "N records selected"; `widgetTitle` moved from Debug into the `widgets` host; `e2e/record-details.spec.ts`. ✅ 2026-10-31 (vitest, typecheck, top comments green; Playwright written, not run), deviations: records in the order ticked; a redraw (also another width) drops them; Debug's result table has no checkboxes; collapsed state per record place in `workspaceState`; the search highlight leaves the details *(all proposed)* | a table's ticked rows in Details and the status bar |
| 7f.1 ✅ | **review fix: Details' record views** (§3.4.2, §3.4.5): `createView`'s `state` is optional (without it nothing is kept); Details passes none, so every record view starts open instead of taking the state stored under `record.<index>` from another table or selection. ✅ 2026-10-31 (vitest) | closing a record of one table leaves the others open |
| 7f.2 ✅ | **review fix: comment wrap** (§3.10): the top comments and tests' headers where steps 7a–7f inserted text without re-wrapping (`dashboards`, its tests, `table` tests, `window-layout`, `ui`, `widgets-testing`) are wrapped to 120 columns again; wording unchanged. ✅ 2026-10-31 | — |
| 7f.3 ✅ | **review fix: §3.11 sketch** follows the code: `registerBottomPanel` dropped (gone since 7e), `createView` (7c), `ActiveWidget` with `records` and an excerpt of `WidgetContext` with `selectRecords` (7f), the `details` extension in the table. ✅ 2026-10-31 | — |
| 8 ✅ | **the batch of 2026-10-31 planned** (§3.14): D1–D15 written into this concept (§3.14, §3.8 rewritten for the signed pills) and into the Perspective concept (§4.8); docs only. ✅ 2026-10-31 | — |
| 8a ✅ | **D1 start page** (§3.4.3): the time range, refresh and Debug's status item registered once with `ui.registerBarItem`, so they show on every page, "/" included ("No active chart" there); `hasQueries` (`hosts/page/page.ts`) and `registerBarItemWhile` (`hosts/ui/bar/bar.ts`) deleted; Details' "N records selected" stays registered and is `hidden` while none *(proposed)*; tests: the "not on the start page" cases dropped, Details' status checked by `hidden`; `e2e/start-page.spec.ts` checks the time range, refresh and status bar on "/". ✅ 2026-10-31 (vitest, typecheck, top comments green; Playwright written, not run) | "/" with the time range and the status bar |
| 8b ✅ | **D2 active widget** (§3.4.4, §3.4.5): `widgets.active` is the widget itself (`RenderedWidget`: `status` + `onDidChangeStatus`, `records` + `onDidChangeRecords`; the impl class `WidgetInstance` is its renderer's context too), `onDidChangeActive` only on another widget or tab or its removal; `ActiveWidget` and its copies gone, the host's `statusChanged` / `recordsChanged` gone; Debug follows the active widget's status, Details its records (resubscribed on `onDidChangeActive`); Details' draw guard gone (only records or the widget redraw it); tests: `fakeWidget` in `widgets-testing.ts`. ✅ 2026-10-31 (vitest, typecheck, top comments green; Playwright not run, the e2e specs see no API and stay), deviations: the type is named `RenderedWidget`, events carry no value (read `status` / `records`); with records a widget is activated before its records' event fires; a removed widget's late `selectRecords` is ignored; Debug keeps the guard for an aborted query putting back the status it asked for *(all proposed)* | Debug and Details as before |
| 8c ✅ | **D3 + D4 quick input, click to filter** (§3.8, §3.11): `ui.showQuickPick(items, {title, placeholder, anchor})` (typing narrows, fuzzy by label else description, headings only with their items) and `ui.showInputBox({title, prompt, placeholder, value, anchor})`, both and `createQuickPick` (`anchor`) at a point or below an element, else at the top in the middle (search everywhere stays there); items with an icon (`{svg, label}`) and `checked`, separators without a label as lines; the fuzzy matcher moved to `frontend/core/fuzzy`; `showContextMenu` draws every registered menu in it (`context-menu.ts` builds the items, the old menu list and its CSS gone); a filter button's `...` asked with `showInputBox` below the button instead of `prompt()`; a click on a mark, a table cell or an Explore group row: `offerFilters` (Filter / Exclude per candidate, the pill at once); `showChoices`, the floating bar, the selection model and `widget/selection` deleted; `selectOnClick` renamed `filterOnClick`. ✅ 2026-10-31 (vitest, typecheck, top comments green; Playwright written, not run), deviations: `=` in both labels, the icon (and its accessible name) tells filter from exclude; no new right-click menus (only `table/cell` opens on one, as before); a menu's command runs synchronously as the box closes (`QuickInput.pickOne`), `showQuickPick`'s promise after it *(all proposed)* | click to filter in one step |
| 8d ✅ | **D5 layout** (§3.4): one top bar (`WindowLayout.topBar`, `registerBarItem('top', …)`: `left` items, the tab bar, `center` / `right` items; `Bar` takes the tab bar as its fixed middle), the title bar gone; the global menu's "…" (`workbench/global`, hidden while empty) and the Dashica icon (`ChartColumn`) before the tabs, "+" after them (`TabBar.onDidAdd`: "/" in a new tab); `ui.registerRailButton` (a rail button running a command, its tooltip with the key), search everywhere's first in the left rail (its field and `search-everywhere.css` gone); every side panel under a header (name in caps, "…" showing `panel/<id>` with "Hide", `workbench.view.<id>.hide`); a panel button's tooltip already named its name and key (since the layout's port), now shared by panel and command buttons; `e2e/top-bar.spec.ts`. ✅ 2026-10-31 (vitest, typecheck, top comments green; Playwright written, not run), deviations: "Hide" in every panel menu so "…" is never empty; the global "…" hidden until 8i gives it entries; "+" opens "/"; the icon is lucide's, not a logo; tooltips stay the native `title` *(all proposed)* | the new top row |
| 8e ✅ | **D6 signed pills** (§3.8): `sql.Quote`, `sql.Condition`, `.FilterAs`, `sql.Table` (`sql.FromFile(path, opts...)`), `sql.TableOf`; `filter.TableOf` / `New` / `Sign` / `Open` / `Apply` (key `<payload>.<mac>`, HMAC-SHA256 with `filters.secret`, checked at start by `dashica.New`); `<dataUrl>/pill` (`{key, label}`, 422 for a field that cannot filter, 400 for another op); the pills of the chart's table into its WHERE, `eq` OR-ed and `ne` AND-ed per field; 400 for a pill that does not open; the node's `filterable` in `page.json` (generator, golden contract); deleted: `filter.Filter` / `Condition` / `Param` / `Columns`, the own-field and `DESCRIBE` rules, `clickhouse` `columns.go` and its cache, bound `__f<i>`, `withFilters`, the table's `categories` prop, `WidgetContext.addFilter`, the chip's op flip; client: a pick asks `/pill`, chips `{kind: 'pill', key, label}`; outer dashboards: `sql.Table` on the single-table SQL files, `FilterAs` on their computed fields. ✅ 2026-10-31 (Go vet and tests green but the ClickHouse-bound ones (sandbox); vitest, typecheck, top comments green; Playwright written, not run), deviations: the label inside the signed payload; `filterable` on the node, not in the props; the secret at least 32 characters, checked by `New` only; a pill chip is not edited *(all proposed)* | filters as signed pills |
| 8f ✅ | **D7 filter buttons** (§3.8): a SQL chip that matches one of the page's buttons (`buttonOf`) is not drawn in the chip row; the button shows pressed in its place, its `title` the `queryPart`; the chip's "button title" label and the edit of a button's chip gone; `e2e/filter-chips.spec.ts` expects no chip. ✅ 2026-10-31 (vitest, typecheck, top comments green; Playwright written, not run), deviations: a pressed `...` button shows its values after its title (`Path: /api/`, several joined by `, `); a button's filter is not edited in the bar; on a page without the button it is a plain SQL chip *(all proposed)* | buttons as toggles in place |
| 8g ✅ | **D8 + D9 Explore off, Explore SQL** (Perspective §4.5, §4.7, §4.8): `workbench.json` says `explore`; without it the `explore-view` extension registers only "Explore" in `workbench/global`, greyed, hovered "Explore is not enabled (explore.enabled)" (`EXPLORE_NOT_ENABLED`; `MenuItem.enabled` / `tooltip`, shown by the quick pick as `aria-disabled` and `title`), so no chart menu entry and no page kind `explore` (`#explore=3` renders the dashboard); `HandleSql` and `HandleEditedRows` check `QueryHandler.ExploreEnabled` themselves and return `httpserver.ErrExploreNotEnabled` (404) before any query, the `editable` wrapper and `X-Dashica-Sql` gone (the view always offers its editor); `xsql` → `exploreSql`; `/sql` answers `httpserver.ChartSql` `{sql, parameters}` (generated into the TS contract), the SQL with its placeholders, the values listed beside the editor (`<dl>`), Run puts both into the hash (`exploreSql`, `param_<name>`) and `/rows` binds them (`EditedParameters`); `inline_parameters.go` and its test removed; `e2e/explore-view.spec.ts` skips all its tests while `workbench.json` says Explore is off, `e2e/top-bar.spec.ts` checks the greyed entry. ✅ 2026-10-31 (vitest, typecheck, top comments, `go vet`, Go tests without ClickHouse green; the ClickHouse-bound `rows_e2e_test.go` rewritten, blocked in the sandbox; Playwright written, not run), deviations: the parameters travel as `param_<name>` keys, ClickHouse's HTTP names, in the hash and the rows request; the greyed entry's command `exploreView.open` is registered by 8i; `{{DASHICA_FILTERS}}` stays filled in *(all proposed)* | Explore with placeholders |
| 8h ✅ | **D11 schema view** (Perspective §4.8): Go `clickhouse.Schema` (`Client.Schema(ctx, refresh)`: `system.tables`, `system.columns`, `system.data_skipping_indices` once per connection, kept on its client, `assembleSchema`, the TTL cut from `engine_full`, `tableTtl`), `Manager.Connections`, `httpserver.SchemaHandler` at `/schema.json?connection=<name>[&refresh=1]` (404 while Explore is off, checked in the handler, and for a connection not in dashica_config; replaces the unused `schemaHandler`), `workbench.json`'s `connections`, the node's `connection` in `page.json` (`sql.ConnectionOf`, also used by `filter.TableOf` and the query handler); `Schema` and the node's field generated into the TS contract; the `schema` extension: the left side panel "Schema" (native `<details>`: connection › database › table, the page's connections under "On this page", the others under "Other connections" (since 9x, D32: views, the page's tables and "All connections"); a connection asked when opened first; a table: columns with type, default, comment, then engine, ORDER BY, PARTITION BY, primary key, TTL, comment, skip indices), "Refresh" in `panel/schema` (`schema.refresh`: the connections opened, `refresh=1`); `e2e/schema-view.spec.ts`. ✅ 2026-10-31 (vitest, typecheck, top comments, `go vet`, Go tests without ClickHouse green; `testSchema` in `clickhouse_e2e_test.go` blocked in the sandbox; Playwright written, not run), deviations: the Schema view is part of Explore, so it and `/schema.json` exist only with `explore.enabled`; every database the connection's user sees is listed, `system` included (no filter); the cache lives on the connection's `clickhouse.Client`, for the server's lifetime, until a refresh; the table opens in place in the tree, not in a tab; the client keeps nothing (D12 asks `/schema.json` again, served from the cache) *(all proposed)* | the schema of every connection |
| 8i ✅ | **D10 global "…" menu** (Perspective §4.8): `httpserver.ConnectionRowsHandler` at `/rows?connection=<name>&exploreSql=…&param_…` (404 while Explore is off, checked in the handler, and for a connection not in dashica_config; 400 for an empty text; read-only, `httpserver.ExploreRowLimit`, plain Arrow casts, shared with `HandleEditedRows` by `answerEdited`); the `explore-view` extension registers `exploreView.open` ("Explore" in `workbench/global`: a new tab `#explore=&connection=<name>`) and `exploreView.startFromChart` ("Start from chart…": the quick pick of the shown page's charts with rows, `chartsOf`, their `/sql` into a blank tab's hash); the view without a chart (`widget` `undefined`): a connection picker in its bar (`pickedConnection`, `withConnection`), an empty editor, rows from `/rows?connection=` (`connectionRowsRequest`), a datagrid (`initialView` without a widget); `e2e/explore-view.spec.ts` (two tests, skipped while Explore is off). ✅ 2026-10-31 (vitest, typecheck, top comments, `go vet`, Go tests without ClickHouse green; the ClickHouse-bound test in `rows_e2e_test.go` blocked in the sandbox; Playwright written, not run), deviations: the blank tab is the page kind `explore` with an empty id on the URL of the tab it came from; "Explore" takes the connection of the shown page's first chart, else the first one; "Start from chart…" runs the chart's SQL at once (it goes into the hash as a Run does); one viewer config for all blank tabs *(all proposed)* | Explore without a chart |
| 8j | **D12 SQL editor:** CodeMirror 6 with a ClickHouse dialect, autocomplete from the schema data, loaded with Explore (Perspective §4.8); moved to 9d (§3.15) | highlighting and completion |
| 8k ✅ | **D13 Explore:** settings panel open from the start; "Reset" asks first (Perspective §4.8): `PerspectiveViewer.toggleConfig(true)` on each new viewer after its config; `persistable` leaves out `settings`; "Reset" asks `confirmReset` (`ui.showQuickPick` below the button: "Reset" / "Cancel"); `e2e/explore-view.spec.ts` checks the panel and Cancel / Reset. ✅ 2026-10-31 (vitest, typecheck, top comments green; Playwright written, not run), deviations: the kept config never reopens or closes the panel; Escape or a press elsewhere is Cancel; Reset leaves the panel as it is *(all proposed)* | the viewer's settings at hand, Reset not by accident |
| 8l ✅ | **D14 view pop-out** (§3.4.6): `PageApi.popOut({title, render})` (a new tab `<page>#view=<tab id>`, the page kind `view` rendered by the host while its view is in memory, the page shown taken without fetching `page.json` again, the view forgotten when its tab closes); `storedTabs(list, kept)` leaves the popped tabs out (active: the one of the others shown last); Debug's "Pop out" (`panel/debug`, `debug.popOut`: "Debug: <title>", `followDebug` shared with the panel); Details' "Pop out" (`panel/details`, `details.popOut`: "Details: <title>", `drawComparison`); "Open Speedscope" pops out the viewer in an `<iframe>`; the widget testbed's `page.popOut` records the views (`popped`); `e2e/pop-out.spec.ts`. ✅ 2026-10-31 (vitest, typecheck, top comments green; Playwright written, not run), deviations: the popped tab's time range and filters change nothing it shows; Debug's tab follows its widget's status, Details' keeps the records of the pop (the table clears them on each answer); a `#view=` link or a reload shows the page; Speedscope stays a link for a modifier click *(all proposed)* | views as tabs |
| 8m ✅ | **D15 ad hoc pills** (§3.8): Go `sql.Values` (a builder query's base: its From and Where, `SELECT toString(<definition>) AS __value … GROUP BY __value ORDER BY __value LIMIT 100`, `positionCaseInsensitive(…, {__search:String}) > 0`; a SQL file's or string's result in a subquery), `httpserver.HandleValues` (JSON array of strings, `ValuesLimit` 100), `<dataUrl>/values?field=…&search=…` (`valuesHandler`: 422 as `/pill`, 400 for an unsigned pill, the time range, SQL chips and the other pills applied); the node's `table` in `page.json` (generator, golden contract); client: `filterableTables` (per table each field once, with the first chart naming it), `addFilter` (table, skipped when there is one; field; `=` / `≠`; value) and `pickValue` (`createQuickPick`, asked again 200 ms after the typing rests, the earlier request aborted), `fetchValues`, `fetchPill` exported from the `widgets` host; "Add filter" after the chips in the filter bar; `e2e/add-filter.spec.ts`. ✅ 2026-10-31 (Go vet and tests green but the ClickHouse-bound ones (sandbox; `TestHandleValues_TheValuesOfAFieldThatContainTheSearch` written, not run); vitest, typecheck, top comments green; Playwright written, not run), deviations: the pills on the asked field (its table) are left out of `/values`, so a value beside one filtered by is still offered; a SQL file's values come from its result (its own LIMIT included), since its field is a column of the result; the typed text is offered first as a value of its own ("as typed"); "Add filter" makes the filter bar show on every page with `filterBar` whose charts filter a table; the table step is skipped for one table *(all proposed)* | filters without a click on a chart |
| 8n ✅ | **Review fixes of the batch:** `X-Dashica-Diagnostics` in ASCII (percent-encoded since 9u; `asciiJSON`: non-ASCII as `\u` escapes, so "≠" and umlauts in pill labels survive the browser's Latin-1 reading of headers); the `page.json` test with a ClickHouse manager (nil since 8m, it panicked); a filter button's `...` value written in as a string literal's text (`literalOf`: `\` and `'` escaped, as `sql.Quote`; `buttonOf` undoes it; a replacer function, so `$'` stays text); `golang.org/x/sync` indirect in `go.mod`; one `OP_ICONS` (`widgets` host) for a chart click and "Add filter". ✅ 2026-10-31 (vitest, typecheck, top comments, `go vet`, Go tests without ClickHouse green; the ClickHouse-bound ones blocked in the sandbox), deviations: CI's `go test` of `dashica-src` runs `./...` (outer repo's `ci/test.gitlab-ci.yml`, edited, not committed here), so `lib/clickhouse`, `lib/alerting`, `lib/dashboard`, `filter`, `widget` and `explore` run there too; `go.mod` keeps its other entries `go mod tidy` would change (certmagic, rigging, goldmark …); the SQL chips stay unsigned (D6): a `?sql=` link or a `...` outside quotes still runs a viewer's own SQL *(all proposed)* | the review's findings fixed |
| 9a ✅ | **D16 SQL chips behind `filters.sqlEnabled`** (§3.15): `config.FiltersConfig.SqlEnabled` (default false, `FILTERS__SQLENABLED`), `rendering.Dependencies.SqlEnabled`, `workbench.json`'s `sqlEnabled`; `httpserver.ParseQueryState(r, sqlEnabled)` answers a `sql` with `ErrSqlNotEnabled` (400) while it is off, so every reader of the query state refuses it before any query (`TimeRangeHandler` a struct with `SqlEnabled`); the filter bar without funnel and SQL chip editing, the table's cell menu without its SQL entries while it is off. ✅ 2026-10-31 (vitest, typecheck, top comments, `go vet`, Go tests without ClickHouse green; the ClickHouse-bound ones blocked in the sandbox), deviations: also the handlers that never apply a SQL chip (alerts, `/time-range`) refuse one; Speedscope answers an unreadable query state with 400; set the flag in the file or the environment, not both (the file's key wins); the filter buttons fail with 400 while it is off until 9b; the local configs turn it on *(all proposed)* | SQL chips only where configured |
| 9b ✅ | **D17 filter buttons signed** (§3.15): `filter.NewButton` (a pill without table: the `queryPart`, a `...` as `sql.Quote(value)`, `Button` and `Value` signed), `Apply` puts it into every query that takes filters; `page.json`'s buttons with `key` (signed at registration) or `url` (`<page>/button?i=<index>`, `dashboard.buttonHandler`: `{key, label}`); Speedscope applies the pills; client: `pillButton`, `buttonOf(chip, buttons)` by `queryPart`, a pressed `...` button's values beside it, each asking a new value in its chip's place; `literalOf` gone; outer dashboards' `'...'` as `...` / `concat(..., '%')`. ✅ 2026-10-31 (vitest, typecheck, top comments, `go vet`, Go tests without ClickHouse green; the ClickHouse-bound ones, the new `>=` check among them, blocked in the sandbox; Playwright written, not run), deviations: one key format and `f` for pills and buttons, the button found by its `queryPart`; `queryPart` stays in `page.json`; a page with buttons needs the secret to register; a query that skips filters names a button as ignored; Speedscope also applies the pills on its table; a pressed `...` button's values as buttons beside its title; a refused value is only logged *(all proposed)* | buttons with SQL chips off |
| 9c ✅ | **D18 pills editable** (§3.15): the shown value in the signed key (`Pill.Value`, the alias was in `Field` already); client: `pillField(key)`, `fieldSource(tables, field)`; a field's pill as field, operator and value, the operator switching `=` / `≠` and the value asked in "Add filter"'s quick pick (`pickValue`, the chart's `/values`), each made again through that chart's `/pill` and `replace`d at its index; a pill no chart of the page makes only removed, its tooltip saying why. ✅ 2026-10-31 (vitest, typecheck, top comments, `go vet`, Go tests without ClickHouse green; the ClickHouse-bound ones blocked in the sandbox; Playwright written, not run), deviations: `Value` serves pills and buttons alike; an empty value shows "(empty)"; the value's quick pick starts empty, not with the value; an edit that came back while another chip took the place is dropped; a refused edit is only logged *(all proposed)* | pills edited as in Grafana |
| 9c fix ✅ | **Review fixes of 9a–9c:** `Pill.Value` always in a field pill's key (no `omitempty`) and `pillField` `undefined` for a key without it, so a pill signed before 9c is only removable instead of being made again as `<field> != ''`; `filters.replace` removes the chip at its index when the new chip is there already, so an in-place edit (operator, value, a `...` button's value) never puts the same `f` twice into the URL; the filter bar's row in §2 and the 9a block say which chips are editable and that 9b made the buttons work with SQL chips off. ✅ 2026-10-31 (vitest, typecheck, top comments, `go vet`, Go tests without ClickHouse green; the ClickHouse-bound ones blocked in the sandbox), deviations: a button's key now carries `"value": ""` too (golden contract regenerated); an old pill's tooltip is its label, without a reason *(all proposed)* | the review's findings fixed |
| 9e ✅ | **D19 records by command** (§3.4.5, §3.15): `records`, `onDidChangeRecords` (`RenderedWidget`) and `selectRecords` (`WidgetContext`) removed from the `widgets` host, and with them the activation by records; the table's renderer keeps its ticked rows and runs `details.showRecords` with `{ widget, records }` on each change, and with none when a new answer or its removal clears ticked rows; `drawTable`'s `selectRecords` is its own callback type; Details keeps what the command gave it (no `widgets` any more), counts it, pops it out; `fakeWidget` without records; tests: table (the command's calls, the press making it active), Details (by command, another table's clear leaves the records); `e2e/record-details.spec.ts`: Details keeps the records when another chart becomes active. ✅ 2026-10-31 (vitest, typecheck, top comments green; Playwright written, not run), deviations: the command's argument is `{ widget: WidgetNode, records }`, the `WidgetNode` the records' identity; a clear from another widget than the shown one leaves Details as it is; another active widget or tab leaves Details as it is; without `details` the command's failure goes to the console *(all proposed)* | a table's ticked rows in Details as before; they stay when another chart becomes active |
| 9f ✅ | **D20 filter UI is the filters extension's; charts run filters.offer** (§3.8, §3.15): `WidgetsApi.offerFilters`, `WidgetContext.offerFilters`, `filterPicks`, `OP_ICONS`, `fetchPill` and the host's `showQuickPick` leave the `widgets` host; `extensions/filters/offer.ts` (`offerFilters(ui, query, at, candidates, source)`, `OP_ICONS`, `fetchPill`), registered as `filters.offer` on the extension's `ui` and `query` (the tab shown); `chart-library/filter-on-click.ts`: `OfferFilters` (the callback `filterOnClick` and `drawTable` are given) and `offerFiltersOf(commands, { dataUrl, filterable })`, which the renderers of `timeBar`, `timeLine`, `barVertical`, `barHorizontal`, `timeHeatmapOrdinal`, `table` and the Explore view use (they get `commands` from their extension's context); `widgetTestbed` registers a recording `filters.offer` (`offers`) in place of the extension, `choices` / `candidates` / `choose` / `pill` and its `/pill` answer gone; the host's tests moved to `extensions/filters/offer.test.ts`, the renderers' tests check the command's arguments, `filters.test.ts` the registered command. ✅ 2026-10-31 (vitest, typecheck, top comments green; no Go change; Playwright not run, no spec changed), deviations: one helper `offerFiltersOf` names the command for all seven places instead of seven `executeCommand` calls; the candidates are filtered by `filterable` in the extension, as before in the host; without `filters` the unknown command goes to the console, as `details.showRecords` does; `filters.offer` resolves when the pick is done *(all proposed)* | the click's quick pick as before, owned by `filters` |
| 9g ✅ | **D21 a pill's key read by the filters extension** (§3.15): `pillLabel`, `pillButton`, `pillField` and `PillField` move from `hosts/query/query-impl.ts` / `query.ts` to `extensions/filters/pill-key.ts`; the `query` host's chips are opaque (`{kind: 'pill', key}` / `{kind: 'sql', sql}`, `Pill` only `{key}`), `parseChip` and `filters.add` keep no label; the filter bar reads each chip's label from its key; `fetchPill` and `fetchButtonPill` give the key only; the key tests moved from `query.test.ts` to `pill-key.test.ts`, the chip expectations of the other tests lost their `label`. ✅ 2026-10-31 (vitest, typecheck, top comments green; no Go change; Playwright not run, no spec changed), deviations: `Pill` stays the type `filters.add` takes, now `{key}`; the server's `/pill` and `/button` answers keep their `label`, which the client ignores *(all proposed)* | chips as keys in the query host, read by `filters` |
| 9h ✅ | **D22 chart frame and shared helpers into extension libraries** (§3.5, §3.15): `ChartFrame` (`chart-frame.ts` / `.css`) moves from `hosts/widgets/chart-frame/` to `extensions/chart-library/`, `widgets.ts` no longer exports it, `ChartFrameOptions` or `DrawOptions`; `widgetTitle` moves to `extensions/widget-library/widget-title.ts` (Debug, Details, and the Explore view's `chartTitle` on it instead of its own copy), `formatTime` to `extensions/time-library/format-time.ts` (the time picker, `ChartFrame`); all imports follow; the `ChartFrame` tests moved from `widgets.test.ts` to `chart-library/chart-frame.test.ts`, new tests for `widgetTitle` and `formatTime`, the query host's custom-range test sets local times as text. ✅ 2026-10-31 (vitest, typecheck, top comments green; no Go change; Playwright not run, no spec changed), deviations: two library folders by the helpers' users (`widget-library`, `time-library`) instead of one; `showWidgetError` stays in the `widgets` host, unexported (only the host uses it); `.d-widget-error` stays in `widgets.css`, also used by `ChartFrame` *(all proposed)* | charts as before; the `widgets` host only renders and tracks the active widget |
| 9i ✅ | **D23 layout fix of D5** (§3.4, §3.15): the grid has two rows (sides and centre, status bar); the left and the right side span the first, from the window's top to the status bar; the top bar (tabs, "+", the `left` / `center` / `right` items) is the centre column's first child, above the filter bar and the content; `SideBar.railStart` (a `display: contents` slot before the rail's buttons, which `#place` never passes) and `WindowLayout.railStart` / `UiHost.railStart` (the left one) take the global menu's "…", now a rail button (`wb-global-menu`), above search everywhere; the Dashica icon (`.d-brand`, `dashboards`) is gone; tests: the layout's regions and the grid rows (CSS), the rail start before later buttons, the "…" first in the left rail (`workbench.test.ts`), search everywhere first after it, the start page reached by "+"; `e2e/top-bar.spec.ts` (no icon, the sides full height, the top bar only over the content, the "…" above search) and `e2e/start-page.spec.ts` ("+" leads back). ✅ 2026-10-31 (vitest, typecheck, top comments green; no Go change; Playwright written, not run), deviations: the right side is full height too; the "…" sits in a slot of the rail rather than being a rail button with a command (it shows a menu at itself, a command knows no anchor); a left side without panels and rail buttons stays hidden, the "…" with it (the workbench always has Dashboards and search everywhere) *(all proposed)* | the sides from top to bottom, the tabs over the content, "…" in the rail |
| 9j ✅ | **D24 query state registered by key** (§3.7, §3.15): `QueryApi.registerState(id, spec)` / `state(id)`, `QueryStates` shared by the tabs (the page host's), values parsed lazily from the tab's search and written into the spec's keys (other keys kept), `requestParams` the states' `request` entries in registration order; `time-library/time-state.ts` (`timeState`, `customRange`, `presetRange`) registered by `time-range`, set by `ChartFrame`'s dragged range; `time-library/refresh-state.ts` registered by `refresh`, which runs the timer (the active tab only, one interval after its last refresh, paused while hidden, catching up once; `setShown` gone); `filters/chips.ts` (`chipsState`, pure `addChip` / `replaceChip` / `removeChips`; `FilterChip` and friends leave the host), the command `filters.addSql` for the table's cell filters; `widget-library/params-state.ts` (`paramsState`, `paramsOf`, `withParam`) registered by `dashboardPage`; `load({ search, page })`; tests moved to the specs and extensions (`time-state`, `chips`, `params-state`, `refresh`). ✅ 2026-10-31 (vitest, typecheck, top-comments; Playwright not run) | the URLs as before; each extension owns its keys |
| 9k ✅ | **D25 pill ops by the field's type** (§3.8, §3.15): `sql.Op` (`eq` `ne` `lt` `le` `gt` `ge`; `Valid`, `Sign`, `Compare`), `FilterAs(func(op sql.Op, value string) string)`, `sql.Condition(field, op, value)`; `filter.New(…, op, value, type)`, `Pill.Type` signed, `Apply` OR-s only `eq`; `/pill?…&op=…&type=…`; `/values` answers `{type, values}` (`any(<definition>) AS __type` from the JSON `meta`) with the resolved time range; `X-Dashica-Column-Types` on every Arrow answer from the `DESCRIBE` it runs anyway (`util.ASCIIJSON`); client: `widget-library/clickhouse-type.ts` (`typeKind`, `pillValue`), `filters/ops.ts` (`opsOf`, `OP_SIGNS`, `OP_ICONS`), `chart-library/candidate.ts` (`candidateOf`), `QueryResult.dashicaColumnTypes`, a click's quick pick per op of its type, "Add filter" asking `/values` before the op and a time's value in an input box (`askValue`), a pill's op button a quick pick of its type's ops; outer dashboards' `FilterAs` as `op.Compare(…)` (not committed). ✅ 2026-10-31 (vitest, typecheck, top comments, `go vet`, Go tests without ClickHouse green; the ClickHouse-bound ones, the new ISO time check among them, blocked in the sandbox; Playwright written, not run), deviations: the type signed into the key from the client; one `/values` before the op; the column types from the existing `DESCRIBE`; time buckets still without pills; a time's text parsed by ClickHouse only; `FilterAs` gets the op *(all proposed)* | `≥` / `≤` on times and numbers |
| 9l ✅ | **BUGFIX "Add filter" reads no values for the type** (§3.15 D25): Go `sql.ValueType(q, field)` (a builder query's base selecting `<definition> AS __type` with `WHERE 0` added, no GROUP BY, ORDER BY or LIMIT; a SQL file's or string's result in a subquery with `WHERE 0`), `<dataUrl>/type?field=…` (`valuesHandler` with the query maker as a parameter: `sql.Values` for `/values`, `sql.ValueType` for `/type`, the same 422 / 400 checks, `{type, values: []}`); client: `fetchType` (the type and the resolved time range), "Add filter" asks `/type` before the op instead of `/values`, so picking a time runs no `GROUP BY` over its distinct values; a category's values are asked in the value step. ✅ 2026-10-31 (vitest, typecheck, top comments, `go vet`, Go tests without ClickHouse green; whether ClickHouse reads nothing for `WHERE 0`, and whether it still runs a SQL file's subquery, not checked: the sandbox blocks ClickHouse), deviations: a separate `/type` endpoint rather than a flag on `/values`; a category field now asks twice (`/type`, then `/values`), the first one reading no rows *(all proposed)* | a time field's type without a scan |
| 9m ✅ | **BUGFIX a click's DateTime64(6) keeps its µs** (§3.15 D25): `pillValue` writes a `DateTime64(P)` with P fraction digits, at least 3 and at most 6 (`2026-10-31T10:00:00.123456Z`), from the ms fraction apache-arrow 21 reads a Timestamp in µs or ns as (`divideBigInts`), rounded to the µs with a carry into the next ms; before, `toISOString` cut it to the ms, so `≤` excluded the clicked row and `=` matched nothing. ✅ 2026-10-31 (vitest, typecheck, top comments green; the test reads its values through apache-arrow's own Timestamp vectors), deviations: a `DateTime64(7…9)` compares to the µs, rounded (a JS number carries a ms fraction to about 0.25 µs), so a click on a ns value may still miss itself with `=` *(proposed)* | a clicked µs time matches its row |
| 9n ✅ | **BUGFIX concept §3.8 on the key**: the key's payload is the whole pill (connection, table, field, op, condition, label, value, type; a button's its condition, label, button and value), signed; the client reads the label and what it edits by from the key, not from `/pill`'s `label`. ✅ 2026-10-31 (text only) | the concept says what the key holds |
| 9u ✅ | **D34 free text in headers percent-encoded** (§3.8, §3.15): `WriteDiagnostics` and `columnTypesHeader` write their JSON through `url.PathEscape`; `fetchQueryResult` (`widgets` host) and `fetchRows` (`explore-view/rows.ts`) `decodeURIComponent` it before `JSON.parse`; `util.ASCIIJSON` and its test gone; Go tests: a non-ASCII label round-trips, the column types' header encoded, the handlers' Diagnostics compared decoded; vitest: the encoded headers decoded. ✅ 2026-10-31 (vitest, typecheck, top comments, `go vet` here and in the outer repo with and without `-tags solarwatt`, Go tests without ClickHouse green; the ClickHouse-bound ones blocked in the sandbox) | "≠" and umlauts in headers without hand-written escapes |
| 9v ✅ | **D35 the config injected, not copied flags** (§3.15): `rendering.Dependencies.Config` (`*config.Config`, read only) replaces `ExploreEnabled`, `FilterSecret` and `SqlEnabled`; `QueryHandler`, `SchemaHandler` and `ConnectionRowsHandler` get `Config` as a field, `TimeRangeHandler` no field; `httpserver.ParseQueryState(r)` only reads the request; `QueryState.SqlClause(timeRange, cfg.Filters)` answers SQL chips with `ErrSqlNotEnabled` (400) while `filters.sqlEnabled` is off, so `/query`, `/debug`, `/rows`, `/sql`, `/values`, `/type` and Speedscope refuse them and `/time-range` and the alert widgets take them; `newDashicaImpl` takes the config from `deps.Config`; the unused `queryAlertsHandler`, `queryAlertChartHandler` and `debugCalculateAlertsHandler` deleted. ✅ 2026-10-31 (vitest, typecheck, top comments, `go vet` here and in the outer repo with and without `-tags solarwatt`, Go tests without ClickHouse green; the ClickHouse-bound ones blocked in the sandbox), deviations: the check is a parameter of `SqlClause` (the one place a chip goes into a WHERE) rather than a separate call at each handler; a chart's `/sql` with Explore off is a 404 before the SQL-chip 400 *(both proposed)* | one source of the settings |
| 9w ✅ | **D36 typed query keys** (§3.7, §3.15): `queryKey<T>(urlKeys, { parse, format, sentToServer })` in `hosts/query/query.ts`; `QueryApi.get` / `set` / `onDidChange(key, listener)` in `QueryHost` and `activeQuery`; `QueryKeys` (the keys used, in first-use order, shared by the tabs, a URL key in one key only) replaces `QueryStates`; `TIME`, `REFRESH`, `FILTERS`, `PARAMS` replace `timeState` / `TIME_STATE`, `refreshState` / `REFRESH_STATE`, `chipsState` / `FILTERS_STATE`, `paramsState` / `PARAMS_STATE` / `paramsOf`; `registerState`, `state<T>(id)` and the registrations' dispose gone; `WidgetContext.state` → `ctx.query`, the data fetch `ctx.query()` → `ctx.runQuery()`; every use and test migrated (`time-range`, `refresh`, `filters` with `offer` / `add-filter`, `ChartFrame`, the form widgets, Speedscope, `dashboardPage` without a registration). ✅ 2026-10-31 (vitest, typecheck, top comments green; no Go change; Playwright not run, no spec changed), deviations: `ctx.runQuery()`; `queryKey`'s first argument the URL key(s); `sentToServer` a function for `TIME`; a key is sent once used; the params error gone *(all proposed)* | `query.get(TIME)` |
| 9o ✅ | **D26 no funnel; "SQL condition…" in "Add filter"** (§3.8, §3.15): `FilterBar.toggle` (the funnel, `ui.registerBarItem('top', …)`) and the `new` SQL chip in edit mode are gone; `addFilter(ui, query, tables, anchor, sqlEnabled)` ends its first quick pick with a separator "Advanced" and "SQL condition…" while `sqlEnabled`, which asks the condition in `showInputBox` and adds a SQL chip (`addSqlCondition`); "Add filter" shows while a chart filters a table or `sqlEnabled`. Files: `frontend/extensions/filters/{filters,add-filter}.ts` (+ tests), `e2e/{filter-chips,add-filter,top-bar}.spec.ts`. ✅ 2026-10-31 (vitest, typecheck, top comments green; Playwright written, not run), deviations: the step's id is 9o, as 9l was taken by a bugfix; with the flag on, the filter bar shows on every page with `filterBar`; the input box is one line *(all proposed)* | SQL typed only as the advanced way of "Add filter" |
| 9p ✅ | **D27 table columns and computed fields; no constants** (§3.8, §3.15): Go `sql.IsCategory` false for a lone literal, `sql.IsConstantColumn` (a SQL file's `'darkred' AS color`), `sql.ColumnOf`, `sql.ColumnField`, `sql.QuoteIdentifier`; `clickhouse.Schema.Columns`; `filter.Pill.Column` (signed); `widget`: `filterableFields(deps, chart)` without constants (the file read with `deps.FileSystem`), `filterBy` (`field=` or `column=`, the column checked against `Client.Schema`), `tableColumns`, `<dataUrl>/columns` (`columnsHandler`, not behind Explore), `/pill`, `/values`, `/type` taking `column`, `httpError` 422 for `ErrCannotFilter`; `Node.Computed` (`computed` in `page.json`, generator, golden contract) and `Node.Table` for every chart with a table; client: `FilterableTable.widget`, `FilterableField.computed`, `fieldItems` ("Table columns" from `fetchColumns`, "Computed fields"), `FieldRef` / `fieldParam` (`offer.ts`), `fetchValues` / `fetchType` / `fetchPill` by `FieldRef`, `pillField`'s `column`, `fieldSource` of a column the table's first chart; tests: Go (`sql`, `clickhouse`, `widget`; `columns_e2e_test.go` against ClickHouse), vitest (`add-filter`, `filters`, `pill-key`), `e2e/add-filter.spec.ts`. ✅ 2026-10-31 (vitest, typecheck, top comments, `go vet` here and in the outer repo with and without `-tags solarwatt`, Go tests without ClickHouse green; the ClickHouse-bound ones, the new `/columns` and column `/pill` checks among them, blocked in the sandbox; Playwright written, not run), deviations: the step's id is 9p, as 9n was taken by a concept bugfix; a separate `column` parameter and a signed `column` flag; the constant column of a SQL file found by a regular expression, a literal in any SELECT; every SQL file field computed; a column's values over the plain table for a SQL file chart; the plain fields as columns without the schema; `table` on every chart with a table; a table name without database looked up in `default` *(all proposed)* | every column of the table, no `'darkred'` |
| 9q ✅ | **D29 a readable, short pill key** (§3.8, §3.15): Go `filter.Sign(secret, pill, database)` / `Open(secret, key, database)` write and read `[<connection>:][<database>.]<table>.<field><op><value>[~<condition>]~<mac>` and `@<queryPart>[~<value>]~<mac>` (percent-encoded separators, HMAC-SHA256 truncated to 128 bits, 22 characters of base64url), `filter.ShortName`, `sql.Op.Operator`; `Pill` without `Type` and JSON tags, its `Label` made from the rest, `Column` for a key without condition; `filter.New` without type; `/pill` without `type`, a click on a field that is just a column making the column's pill; `page.json`'s `table` as the key names it; client: `pillField`, `pillButton`, `pillLabel` read the new key, the filter bar asks `/type` when a pill's op or value is edited, `fetchPill` sends no type; e2e specs check the key's form and a hand-changed key's 400. ✅ 2026-10-31 (vitest, typecheck, top comments, `go vet`, Go tests without ClickHouse green; the ClickHouse-bound ones blocked in the sandbox; Playwright written, not run), deviations: step id 9q (9p was taken); `conn:` for the connection; a plain builder field's pill is the column's; a button by its `queryPart`, labelled with its condition off its page; no type in the key, `/type` asked per edit *(all proposed)* | `f` of ~50 characters, readable |
| 9r ✅ | **D28 a chart that ignores filters drawn muted** (§3.6, §3.8, §3.15): `ChartFrame` toggles `d-chart-frame--muted` on its frame while its "ignores …" badge shows (not while skipped, not after a failed query); `chart-frame.css` fades the stage by the new tokens `--opacity-muted` / `--saturation-muted` (`core/style/tokens.css`) and draws it at full strength on `:hover`, `:focus-within` and inside `d-widget--active`; the title row and the badge stay as they are. Files: `frontend/extensions/chart-library/chart-frame.{ts,css}` (+ test), `frontend/core/style/tokens.css`, `e2e/filter-chips.spec.ts`. ✅ 2026-10-31 (vitest, typecheck, top comments green; Playwright written, not run), deviations: the step's id is 9r, as 9o was taken by D26; a muted look of opacity and desaturation together, the same values on both schemes *(proposed)* | one sees at a glance which charts a filter leaves out |
| 9s ✅ | **D30 a menu mode of the quick input** (§3.11, §3.15): `QuickPickOptions.menu` / `QuickPick.menu`; `OwnedQuickPick` conceals its field in a menu until a second letter (`#typed`), `OnePicker.jump` activates the first entry starting with the first letter; `QuickInput.#present` marks the opener (an `Element` anchor of a menu) `aria-expanded`; `quick-input.css` conceals the field and tints `button[aria-haspopup][aria-expanded='true']`; `ContextMenu.show`, `offerFilters`, `confirmReset` and the op pickers (`FilterBar.#changeOp`, `addFilter`'s op step) pass `menu: true`. Files: `frontend/hosts/ui/{ui.ts,quick-input/quick-input.{ts,css},menus/context-menu.ts}` (+ tests), `frontend/extensions/filters/{offer,filters,add-filter}.ts`, `frontend/extensions/explore-view/explore-view.ts` (+ tests), `e2e/{bar-selection,top-bar}.spec.ts`. ✅ 2026-10-31 (vitest, typecheck, top comments green; no Go change; Playwright written, not run), deviations: the step's id is 9s, as 9q was taken by D29; the op pickers are menus; Reset's question a heading *(all proposed)* | menus without a search field, the opener pressed while open |
| 9t ✅ | **D31 enablement belongs to the command** (§3.11, §3.15): `Commands.registerCommand(id, handler, options?)` with `CommandOptions` `{enablement, disabledReason}`, `Commands.enablement(id)` → `CommandEnablement`; `CommandsHost` keeps the options, skips a key (and a double tap) whose command is not enabled, `executeCommand` ignores it; `ContextMenu` sets `QuickPickItem.disabled` / `tooltip` from it; `SideBar.#railButton` greys a button (`aria-disabled`, `window-layout.css`) and ignores its click; `commandSearch` and `SearchPick`'s rows carry `disabled` / `tooltip`; `MenuItem.enabled` / `tooltip` deleted; `explore-view.ts` (`EXPLORE_NOT_ENABLED` as `CommandOptions`, "Start from chart…"), `details.ts`, `debug.ts` migrated. Files: `frontend/hosts/commands/{commands,commands-impl}.ts`, `frontend/hosts/ui/{ui.ts,menus/context-menu.ts,layout/side-bar.ts,layout/window-layout.css}`, `frontend/extensions/search-everywhere/ui/{command-search,search-pick}.ts`, `frontend/extensions/{explore-view/explore-view,details/details,debug/debug}.ts` (+ tests, new `command-search.test.ts`). ✅ 2026-10-31 (vitest, typecheck, top comments green; no Go change; no e2e spec needed a change, Playwright not run), deviations: the step's id is 9t, as 9r was taken by D28; enabled entries have no hover any more; the new reasons' wording; a disabled command's key goes on to the content; a rail button asks on add, hover, focus and click *(all proposed)* | a command greyed alike in every place |
| 9x ✅ | **D32 the Schema view's views** (§3.15, Perspective §4.8): Go `clickhouse.Schema.Database` (the connection's own database, `assembleSchema(database, …)`); the `schema` extension: views "On this page" (`pageTables`, `onlyTables`, `drawPageTables`: the page's tables, connection › database › table, drawn while the panel shows and for each page) and "All connections" (every connection, asked when opened), `createView` with `globalState`; `Schemas` (each connection's schema asked once, shared, a failure forgotten); "Show comments" (`schema.toggleComments`, toggled, `globalState` `showComments`, `d-schema--no-comments`); `pageConnections` / `orderConnections` gone. Files: `lib/clickhouse/schema{,_test}.go`, `frontend/extensions/schema/schema.{ts,css,test.ts}`, `e2e/schema-view.spec.ts`. ✅ 2026-10-31 (vitest, typecheck, top comments, `go vet` here and in the outer repo with and without `-tags solarwatt`, Go tests without ClickHouse green; the ClickHouse-bound ones blocked in the sandbox; Playwright written, not run), deviations: the step's id is 9x, as 9s was taken by D30; the connection's database in `/schema.json`; "On this page" fetches while the panel shows, drawn open to the tables; comments hidden by CSS; a missing table hinted *(all proposed)* | the page's tables at a glance |
| 9y ✅ 2026-10-31 | **D33 a popped-out view's tab without page bars** (§3.4.6, §3.15): `PageHost.showsPoppedView`; `UiHost.showPageBars(shown)` withholds the top bar's and the filter bar's items (`Bar.withhold`, the tab bar stays); `createWorkbench` calls it on each change of the tabs; tests: `bar.test.ts`, `page.test.ts`, `workbench.test.ts`, e2e `pop-out.spec.ts` (written, not run) | *(proposed)* time range and auto refresh hidden as well, not greyed; id 9y (9t taken by D31) |
| 9z ✅ 2026-10-31 | **D37 the input box validates** (§3.8, §3.11, §3.15): `InputBoxOptions.valueSelection` / `validateInput` (`InputBoxValidationMessage`, `InputBoxValidationSeverity`), the message below the field (`d-workbench__quick-pick-message`, `--error`, `aria-invalid`); a `...` filter button's box named after it, its condition previewed (`buttonCondition`), an empty value refused, a pressed button's value selected. Files: `frontend/hosts/ui/ui.ts`, `frontend/hosts/ui/quick-input/quick-input.{ts,css,test.ts}`, `frontend/extensions/filters/filters.{ts,test.ts}`, `e2e/filter-chips.spec.ts` (written, not run) | *(proposed)* synchronous `validateInput`, `Info` / `Error` only, title not shown; id 9z (9x taken by D32) |
| 9d ✅ 2026-10-31 | **D12 SQL editor** (§3.14, §3.15, step 8j; Perspective §4.8): `frontend/extensions/sql-library/` (`sql-editor.ts`: `SqlEditors`, `SqlEditor`, `SqlCompletion`, `loadSqlEditors`, `completionOf`, `showSqlInputBox`; `codemirror.ts`: the bundle `public/dist/sql-editor.js`, `CLICKHOUSE` by `SQLDialect.define`, `sqlEditors`; `schemas.ts`: `Schemas` / `fetchSchema` moved from `schema.ts`), the bundle in frontendBuild.mjs, tokens `--color-code-*`; the Explore view's editor in place of its textarea (`ExploreViewOptions.sqlEditors` / `schema`, Cmd / Ctrl+Enter runs, the chart's or the picked connection's names completed). Files: `frontend/extensions/sql-library/*`, `frontend/extensions/explore-view/{view,explore-view}.ts`, `explore-view.css`, `view.test.ts`, `frontend/extensions/schema/schema.ts`, `frontend/core/style/tokens.css`, `frontendBuild.mjs`, `e2e/explore-view.spec.ts` (written, not run). ✅ (vitest, typecheck, top comments green; the bundle not built, Playwright not run) | *(proposed)* one `Schemas` per place, the editor's error in its place, identifiers case insensitive for completion, `@lezer/highlight` not listed in package.json (§3.15 D12) |
| 9aa ✅ 2026-10-31 | **D12 / D26 the SQL condition in the SQL editor** (§3.8, §3.11, §3.15): `InputBoxOptions.field` / `InputBoxField` (`QuickInput.showInputBox` shows the caller's field, describes and validates it, takes it on `onDidAccept`; an Escape the field took itself stays the field's); `AskSql`, `SQL_PROMPT`, `SQL_PLACEHOLDER` and `addFilter(…, askSql?)` in place of `sqlEnabled`; `FilterBar` asks a SQL chip's new text in that box below the chip (`#editSql`; `#editorOf`, `#editing`, `focusEditor`, `onDidChangeWanted` and `.d-filter-chip--editing` gone); `conditionCompletion`. Files: `frontend/hosts/ui/ui.ts`, `frontend/hosts/ui/quick-input/quick-input.{ts,test.ts}`, `frontend/extensions/filters/{filters,add-filter}.{ts,test.ts}`, `filters.css`. ✅ (vitest, typecheck, top comments green) | *(proposed)* the chip edited in the box, not inline; one default table; the plain box while the bundle does not load; id 9aa (9m taken by a BUGFIX, every letter used) |
| 9ab ✅ 2026-11-01 | **BUGFIX a single Escape closes the SQL input box** (§3.15 D12, step 9aa): `codemirror.ts` binds CodeMirror's default keys but Escape (`DEFAULT_KEYS`, its `simplifySelection` gone), so the box's prefilled, selected text no longer takes the first Escape; the completion's Escape stays its own. Files: `frontend/extensions/sql-library/codemirror.{ts,test.ts}`. ✅ (vitest, typecheck, top comments green) | *(proposed)* Escape no longer collapses a selection in Explore's editor either |
| 9ac ✅ 2026-11-01 | **BUGFIX a column and a computed field of one name stay two fields** (§3.15 D27): `filter.Apply` groups the pills by table, field, `Column` and op, so `host = web-1` on the column and `host = shop` on `lower(host_name) AS host` are AND-ed, not OR-ed; `/values` and `/type` leave out only the pills of the field asked (`othersThan`: the column's for a column or a field that is just one, else the computed field's). Files: `lib/dashboard/filter/filter{,_test}.go`, `lib/dashboard/widget/widget_common.go`, `query_filters_test.go`. ✅ (`go vet`, Go tests without ClickHouse green; the ClickHouse-bound ones blocked in the sandbox) | |
| 9ad ✅ 2026-11-01 | **D38 (1) the filter contract into `filter-library`** (§3.5, §3.8, §3.11, §3.15): `frontend/extensions/filter-library/offer.ts` (`OFFER`, `FilterCandidate`, `PillSource`, `OfferFilters`, `offerFiltersOf`, + test) out of `hosts/widgets/widgets.ts` and `chart-library/filter-on-click.ts`; the charts, `table`, the Explore view and the `filters` extension import it; `chart-library/offer-testing.ts` (`recordOffers`) replaces the testbed's `offers` and its fake `filters.offer`. ✅ 2026-11-01 (vitest, typecheck, top comments green; no Go change; Playwright not run, no spec changed) | *(proposed)* the testbed's fake command left in this step, not in 9ag; the command's id a constant `OFFER` |
| 9ae ✅ 2026-11-01 | **D38 (2) the widgets host passes the headers through** (§3.4.4, §3.6, §3.8, §3.11, §3.15): `QueryResult` = Arrow `Table & { headers: Headers }` (`fetchQueryResult` reads no header); `WidgetStatus.done` without `diagnostics`; the `dashica*` fields and `clickhouseSummary` gone. Readers next to their users: `filter-library/diagnostics.ts` (`Diagnostics`, `diagnosticsOf`, also for the Explore view's `fetchRows`), `chart-library/candidate.ts` (`columnTypesOf`), `chart-library/time-axis.ts` (`resolvedTimeRangeOf`, `bucketSizeOf`: time bars, time line, alert overview), `alerts.ts` (`thresholdsOf`; `drawTimeBars(…, { offerFilters, thresholds })` draws the lines it is given), `debug.ts` (`clickhouseSummaryOf`); `fakeWidget` takes a `lastResult` (+ tests of each reader). ✅ 2026-11-01 (vitest, typecheck, top comments green; no Go change; Playwright not run, no spec changed) | *(proposed)* `headers` the fetch's `Headers` itself; ClickHouse's summary read by Debug, its only user; Debug's status bar reads the Diagnostics from `lastResult` until 9af |
| 9af ✅ 2026-11-01 | **D38 (3) widget decorations** (§3.4.4, §3.5, §3.6, §3.8, §3.11, §3.15): `WidgetsApi.registerDecorationProvider`, `WidgetDecorationProvider`, `WidgetDecoration {badge, tooltip?, muted?, source}`, `Decorated` (`decorations` + `onDidChangeDecorations` on `RenderedWidget` and `WidgetContext`); `WidgetsHost` asks the providers in order when an answer arrives (before the status tells it), clears them on a failure, asks every rendered widget again when a provider fires or is disposed, skips a provider that throws; the `filters` extension's provider (`filters/decorations.ts`: `filterDecorations`, `filterDecorationProvider`); `ChartFrame` draws a badge per decoration (`d-chart-frame__decoration`, `chart-decoration`), muted while one says so, nothing for an answer without columns, and knows no Diagnostics; Debug's view "Decorations" (`decorationList`) and its status bar's badges; `fakeWidget.setDecorations`; `e2e/filter-chips.spec.ts` finds the badge by `chart-decoration` (written, not run). ✅ 2026-11-01 (vitest, typecheck, top comments green; no Go change; Playwright not run) | *(proposed)* one badge per ignored pill; "skipped: …" a badge, the 204's body empty; the decorations' tooltips' wording; the status bar's badges after rows and time also for a skipped chart; the provider's event `Event<void>` (all widgets asked again) |
| 7+ | each planned when we get there: time selection + synchronized cursor, Go actions | |

| Risk | Mitigation |
|---|---|
| Step 5b is one big switch, with blank dashboards from 5b.5 to 5b.9 | 5a lands the contract first with golden tests; the charts are ported as they behave; Playwright flows before merge |
| Explore unavailable from step 3 until rebuilt | accepted: Explore is experimental; rebuilt after the merge (§6) |
| Long-lived branch drifts from `main` (new dashboards in the outer repo) | dashboards are Go only and keep their builder API; rebase regularly |
| Bound filter values typed `String` against numeric columns | ✅ checked on ClickHouse 25.9 (§3.8): converts; a value that does not convert fails that chart with `TYPE_MISMATCH`. Production runs 26.10: the integration test of 6.4 (`lib/httpserver/query_filters_e2e_test.go`) runs against CI's ClickHouse once CI's dashica-src test job sets `APP_ENV=testing_ci` (today it reads `dashica_config.testing.yaml`, `127.0.0.1:28123`) |
| The same alias means different things in two charts (template dashboards over several tables) | from 8e a pill belongs to one table: the same column in two tables is two pills; a chart on another table reports it as ignored |
| A pill's condition is SQL in the URL | signed by the server (HMAC-SHA-256, `filters.secret`, required); a tampered or unsigned pill is a 400 (§3.8, step 8e) |
| `filters.secret` leaks or changes | a leaked secret lets anyone sign SQL: it stays out of checked-in files (env `FILTERS__SECRET`); a changed secret makes old links' pills a 400 |
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
  - ~~*Drill to detail:* a click on a bar / cell opens the bottom panel with the raw rows behind it: the chart's base
    table and WHERE, the page's filters and time, plus the clicked value (`SELECT * … LIMIT n`).~~ **DROPPED
    2026-10-31**, superseded by Explore (its rows without grouping, its SQL from the chart, Perspective §4): the
    maintainer does not need it any more.
  - *Drill by / ad hoc:* "Open in Explore" from a chart or dashboard carries the chart *and* the current `QueryState`
    (time, filters, params), so you narrow further, regroup by another field or add charts from there. Builds on the
    Explore rebuild below.

  What the design already gives: charts that interpret filters on their base table's columns (§3.8), one `QueryState` that travels in the URL, and
  `widget/context` / `table/row` menus as the entry points.
- **Permissions per dashboard**, with or without filtering. A middleware on a page's subtree; `/workbench.json` filters
  the menu per user. What the design already gives: structured filters carry only ids and bound values, so they cannot
  change a query (from 8e: conditions only the server wrote and signed); the SQL chips are client-sent SQL, in one repeatable parameter (`sql`), parsed in one place, as is
  the Explore view's edited query (`exploreSql`, Perspective concept, behind `explore.enabled`), so both can be limited to
  an "advanced" role. Real protection for free SQL must sit in ClickHouse (a readonly user per role, grants, row
  policies, query limits), not in string checks.
- **MCP server with built-in anonymization**: sensitive data must never reach the cloud provider. What the design
  already gives: dashboards are machine-readable (`page.json`), and every query goes through one path (`QueryState` →
  handler), the single place where an anonymization step on results would sit.
- **Perspective instead of the Tabulator table** ([perspective-dev.github.io](https://perspective-dev.github.io/)):
  it reads Arrow, which the query results already are, and pivots, groups and filters in the browser. To check: what
  the table's own features (search highlight, sticky tooltips, record details, add-filter menus) cost to rebuild on it.
- Client extensions from the instances (outer repo); other database backends; query
  understanding (AST).

## 7. Open questions

1. **Time selection:** does "Filter to window" need its own chip, or is it a second, narrower time range?
2. ✅ **Filters on SQL files** (decided 2026-10-30): a SQL-file chart interprets filters only on its own output
   column names, which ClickHouse resolves in WHERE; no `.FilterAs` / `.AcceptFilter` / `sql.Table`. Every other
   filter is reported as ignored (§3.8). **Reversed 2026-10-31 (D6, step 8e):** a SQL file takes pills only when it
   names its table (`sql.Table("default.http_logs")`); a field writes its own condition by `.FilterAs`.
3. **Alerts and filters:** should dashboard filters ever apply to alert widgets (e.g. only alerts of host `a`)? For
   now no.
4. **Drill-down:** ~~is "drill to detail" (raw rows in the bottom panel) wanted early, before the Explore rebuild?~~
   Answered 2026-10-31: drill to detail is DROPPED, superseded by Explore. What does ad hoc narrowing need beyond
   filters + Explore (e.g. regrouping a chart in place)?
5. **Permission model:** roles per dashboard subtree; who may use free SQL; how roles map to ClickHouse users.
6. **Anonymization:** declared per column in Go, or in ClickHouse; reversible (pseudonyms) or not.
7. ✅ **Who interprets a filter** (decided 2026-10-30): the chart, when it runs, in Go; it returns its Diagnostics.
   No page-wide registry of filter fields and no conflict check across charts (§3.8). **Changed 2026-10-31 (D6, step
   8e):** the widget's field writes the condition when the pill is made (`<dataUrl>/pill`); a chart only applies the
   pills of its base table.
8. **Table cells of a SQL file:** a builder table selects in its category columns (6.9); a SQL-file table selects in
   none, since the server knows its output columns only from its text. Should such a table name its category
   columns in Go (`.Categories("host", "status")`), which it then interprets as its own output columns?
9. ✅ **A filter on a measure's alias** (6.9): a base-table column that a select of the chart's query aliases with
   another expression (`sum(bytes) AS bytes`) is ignored (§3.8).
10. **The kind `explore`** (tabs, §3.4.1): the Explore view's tab is the kind `explore`, named in the hash. Is the
    Explore rebuild of §6 (`page.kind === 'explore'`) that same view grown (widget tree, inspector), or a kind of its own?
