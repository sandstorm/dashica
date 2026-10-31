# Workbench — application shell and extensions (technical concept)

Status: concept agreed 2026-10-28; steps 1–5b done (2026-10-30), next step 6; tabs decided 2026-10-31 and done (§3.4.1, step 7a ✅, not yet run in a browser). Branch `feature/workbench` in `dashica-src`; merges to
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
GET  /p/shop/api/<id>/query        widget data (Arrow), what the chart did in X-Dashica-Diagnostics (§3.8)
GET  /p/shop/api/<id>/debug        query, EXPLAIN
POST /p/shop/action/<id>           a Go action (§3.9)                                                        ← new
```

- `page.json` is built **in the same `CollectHandlers` pass** that mounts the widget handlers, so it carries exactly
  the mounted URLs. A compiled dashboard never changes: its JSON is built once at registration.
- **Navigation without reloads:** the shell boots once; a link fetches the target's `page.json` and swaps the active
  tab's content (`history.pushState`, §3.4.1). Panel state survives navigation; the time range does not (§3.7).
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
│▐menu▌ [Shop ×] [Explore: 500 per instance ×]       │▐inspector▌│   tab bar
│▐Debug▌ filters: [Status = 500 ×] [Only errors] ✎ SQL│▐         ▌│   filter bar (above the content)
│▐    ▌ content (scrolls)                          │▐         ▌│   left · content · right
└─ Requests · 1,234 rows · 87 ms · ignores host · 2 records selected ┘   status bar: the active widget, its records
```

| Region | Holds |
|---|---|
| Title bar | breadcrumb, search everywhere, time range, refresh; always visible |
| Tab bar | above the filter bar: a tab per open page, the active one selected, × to close (§3.4.1) |
| Filter bar | above the content, between the side panels, only while it has something to show: one list of chips, structured (`status = 500`) and SQL (`SQL: duration > 2000`), each removable and editable; the page's filter buttons as toggles, a pressed one shown as its chip; the funnel button in the title bar adds a SQL chip (step 7b, §3.8) |
| Left side panel | "Dashboards" (favorites, then the menu groups, each a view, §3.4.2); "Debug" (the active widget's query, stats, EXPLAIN, result, as views, §3.4.4); "Details" (the active widget's selected records, a view each, §3.4.5); later Explore's widget tree |
| Right side panel | later Explore's inspector |
| Status bar | the active widget's title, rows, query time, error, ignored filters (§3.4.4); "N records selected" (§3.4.5) |

- The layout is ported from Zwiebelfisch (`WindowLayout`, `SideBar`: one CSS grid, rails with a button per panel,
  resizable, state remembered, left panel overlays on narrow screens). The bottom panel is gone with step 7e (Debug
  moved to the left side, it had no other user); a table's selected rows show in the left side panel "Details" (§3.4.5).
- **Tabs** (decided 2026-10-31, reversing "one page at a time"): a tab bar above the filter bar; each tab shows one
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
┌─ Dashica › Shop ────────── [⌘K search] ── [Last 1h ▾][⟳ 30s] ┐   title bar: the active tab's time and refresh
│▐menu▌ [Shop ×] [Explore: 500 per instance ×] [Checkout ×]     │   tab bar
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
| commands, `ui` (regions, menus, quick input, floating bars), widget and page renderers, extensions | ✓ | |
| query state (`QueryHost`) | | ✓, from the tab's URL |
| `page.json`, the rendered page | | ✓ |
| the selection (`widgets.selection`) | ✓; switching tabs clears it *(proposed)* | |
| side panels (Dashboards, Debug) | ✓; Debug follows the active tab's active widget (§3.4.4) | |
| the active widget (`widgets.active`) | | ✓, the widget pressed or focused in last (§3.4.4) |

- **`QueryHost` per tab, without `location`.** It takes its state from a given query string
  (`load({ search, defaultTime })`) and reports each change instead of writing the address bar:
  `onDidChangeSearch: Event<string>` (debounced as today; the hash is the tab's, not the query host's). Reading and
  writing the query string become pure functions, `parseSearch(search, defaultTime)` and
  `formatSearch(state, defaultTime, search)` *(proposed)*. The `page` host puts the new search into the tab's `url`,
  and for the active tab into the address bar.
- **Extensions see the active tab.** `ExtensionContext.query` is `activeQuery(page)`
  (`frontend/hosts/query/active-query.ts`): a `QueryApi` that forwards every read and call to the active tab's
  `QueryHost` and fires each model's `onDidChange` when the active tab's fires and once when another tab becomes
  active; `onDidRequestRefresh` only when the active tab's fires (a tab shown catches up itself, below). So the time
  picker and refresh button in the title bar, the filter bar, the table's filter commands and "Filter by …" keep their
  code *(proposed; the alternative, each of them re-subscribing to `page.activeTab.query` on a tab change, repeats
  that in four extensions)*.
- **Widgets see their own tab.** A page renderer gets its tab's `PageContext` and renders each widget with
  `widgets.render(el, widget, context.query)`, so `WidgetContext.state` is that tab's `QueryHost`: a chart in a
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
  registerPageRenderer(kind: string, renderer: PageRenderer): Disposable;
}
interface Tab { readonly id: string; readonly url: string; readonly title: string }

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

- **Opens a tab:** "Open in Explore view" (always a new tab); "Open in new tab" in a dashboard entry's menu
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
`QueryHost.setShown(false)` makes an auto refresh tick count as skipped, exactly as while `document.hidden` (§3.7,
6a); `setShown(true)` refreshes once when one was skipped, the next tick a whole interval later, the same path as
`visibilitychange`. A chart not yet in view queries once it is, as today (`ChartFrame`'s IntersectionObserver; a
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
| `hosts/query/query-impl.ts` | state from a given search, `onDidChangeSearch`, `setShown`; `parseSearch` / `formatSearch` |
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
no favorites a hint to star one. The brand "Dashica" links to it; its tab is titled "Home".

- **Go:** `dashboard.CollectHome` mounts the shell at exactly `/` (the pattern `/{$}`, so other paths still 404) and
  `/page.json` (`dashboard.HomePage`: `{kind: "home", title: "Home"}`, no widgets, no filter bar), from `newDashicaImpl`
  beside `/workbench.json`. `ListenAndServe` serves the Dashica as it is. The outer repo's `/home` page
  (`src/root_page.go`) and its group "Dashica" are gone.
- **Client:** the renderer of kind `home` is in the `dashboards` extension, which owns the favorites: `homePage(menu,
  favorites)` (`extensions/dashboards/home-page.ts`) is a pure function to an element, drawn anew when the viewer
  toggles or moves a favorite in the panel (an `EventEmitter` inside the extension) *(proposed)*. The tiles are links,
  opened by the page host like any other (Cmd / Ctrl+click: the browser's new tab); no star, menu or drag on the start
  page itself *(proposed)*.

#### 3.4.4 The active widget, Debug and the status bar (step 7e, decided 2026-10-31)

As the active editor: the **active widget** is the widget with data the viewer pressed (`pointerdown`) or focused in
(`focusin`) last, anywhere in its element: its title, a mark (whose click still selects, §3.8), its menu button, a table
cell. A quiet accent outline marks it (`d-widget--active`). Each tab has its own; switching tabs shows that tab's.
Escape keeps it; removing the widget (its page rendered anew, its tab closed) ends it.

- **API (`widgets` host):** `widgets.active: ActiveWidget | undefined` (`{widget, url(path), lastResult, status}`, a
  value taken anew on each read) and `widgets.onDidChangeActive` (another widget or tab, the widget removed, its query
  started, answered or failed). `WidgetStatus` = `idle` | `loading` | `done {rows, ms, diagnostics}` | `error {message,
  ms}`, set by `ctx.query()` itself, so every widget with data has one; `ms` is the time until the answer in the
  browser *(proposed)*. Only the latest `ctx.query()` sets the status and `lastResult`: an earlier one still answering
  changes neither, so a refresh during a load keeps "querying…"; an aborted latest one puts back the status of the last
  query that answered or failed *(proposed)*. The host keeps each tab's
  active widget under the tab's query state (the `QueryApi` its widgets render with) and is told the active tab by the
  `page` host (`ActiveQuerySource`, as `activeQuery`); no other registry.
- **Innermost widget with data** *(proposed)*: a press inside a chart inside a grid makes the chart active (the closest
  element with `data-data-url`); containers, markdown and form inputs never become active.
- **Debug is a left side panel** (rail button "Debug", a bug icon, after "Dashboards"; one left panel shows at a
  time): the active widget's title, then views (§3.4.2): Query (the SQL as sent), Stats (ClickHouse's stats and the
  summary of the chart's answer, closed), EXPLAIN plan, Pipeline (graph and steps, closed), Syntax (closed), Result (the
  last result as a table); their collapsed state in the extension's `globalState` *(proposed)*. It asks
  `<dataUrl>/debug` only while it is shown: when shown, when another widget becomes active, and when the active
  widget's query answered or failed (a query state change queries the chart again); while that query runs it keeps
  what it shows, and a change of its records alone (the same status value as when it asked) asks nothing *(proposed)*. Without an active widget: "Click a chart to see what it queried." The chart menu's "Debug" opens the
  panel; pressing the menu button made the chart active already, so no `setActive` exists *(proposed)*.
- **Status bar:** one item of the `debug` extension, always there: the active widget's title, then "1,234 rows · 87
  ms", "ignores host", "skipped: …", "querying…" or the first line of its error (at most 80 characters, red; the whole
  message in the tooltip); "No active chart" without one. A click opens Debug *(proposed)*. The status bar so always
  shows *(proposed)*; the page-wide query counts of the sketch (`query-status`) are not built.
- **The bottom panel is removed** (`BottomPanel`, `registerBottomPanel`, its CSS and stored layout key): Debug was its
  only user.

#### 3.4.5 Selected records and the Details panel (step 7f, decided 2026-10-31)

A table's ticked rows (Tabulator's row selection checkboxes, and the one for all in the header) are the widget's
**selected records**, part of the context model: the active widget carries them, and whoever shows them follows it. The
in-table "N record(s) selected" panel (fixed at the bottom, full screen, close) is gone. A click on a cell still selects
a category for the floating bar (§3.8), unchanged; the two never mix.

- **API (`widgets` host):** `ctx.selectRecords(records)` puts the widget's records (`WidgetRecord`: a row by column
  name) in place of those before; with records the widget becomes its tab's active widget (the press on the checkbox
  made it so already; ticking by keyboard does too). `ActiveWidget.records` (in the order ticked *(proposed)*, empty
  while none); `onDidChangeActive` also fires when the active widget's records change. No `widgets.records` and no
  event of its own *(proposed)*: one value, one event, as for the status.
- **The table:** `drawTable(…, { selectRecords })` draws the checkbox column only with it (so Debug's result table has
  none *(proposed)*), its `rowSelectionChanged` calls it. Each draw starts with no row ticked, so the table's renderer
  clears the records before each draw: a new answer, and also another width or color scheme, drops them *(proposed)*.
- **Details is a left side panel** (rail button "Details", a list-checks icon, after "Debug"): the active widget's
  title, then a view (§3.4.2) per record ("Record 1", …), its fields one below the other as `renderRecordDetails` had
  them (a JSON value pretty-printed, a value of several lines as it is, others as text; built with `htl`, so escaped);
  each view starts open and its collapsed state is not kept: stored by the record's place, closing "Record 1" of one
  table closed "Record 1" of every other table and of the next selection *(proposed)*. Drawn only while
  shown, anew when the active widget or its records change (not on its status). Without records: "Tick rows of a table
  to see them here." The table's search term is no longer highlighted in the details *(proposed)*.
- **Status bar:** a second item, of the `details` extension: "2 records selected", hidden while none; a click opens
  Details *(proposed)*.

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
| `ui` | side panels, views inside them (`createView`, §3.4.2), title bar and status bar items, `registerMenuItem`, `showContextMenu`, `showChoices`, quick pick, messages, search providers |
| `widgets` | `registerWidget` (§3.6), the selection (§3.8), the active widget (`active`, `onDidChangeActive`, §3.4.4) |
| `page` | the open tabs and the page each shows (`page.json`), the active one's `onDidChangePage`, `navigate(url, { newTab })` (§3.4.1) |
| `query` | the state every query depends on (§3.7), one per tab; extensions see the active tab's |
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
ctx.showMenu(menuId, anchor)               // any menu for this widget (its context); the frame's "More": `widget/context`
ctx.addFilter(fieldId, op, value)          // click-to-filter (§3.8); fieldId: the clicked column's alias
ctx.select({kind, fieldId, value, anchor}) // the page's one selection (§3.8, step 6.7); ctx.clearSelection()
ctx.choose(at, candidates)                 // a menu "Select" of candidates; the chosen one is selected (step 6.8)
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
| `filters` | one list of chips: structured filters and SQL chips (step 7b, §3.8); later a time-window filter | `?f=…&sql=…&tw=…`, `f` and `sql` each repeatable, in chip order | per page |
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
(`?sql=…`). Filter buttons stay SQL, written in Go; since step 7b a pressed button shows as a SQL chip ("The SQL
filter is a chip", the end of this section).

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
`categories` (step 6.9, its `computeProps`): the aliases of its own fields (`dimensions()`) that are categories, so
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
| a filter button adds its `queryPart` to the SQL string (asking for `...`), nothing shows it was pressed | `filters.ts` (`showButtons`, `#add`); `dashboard.Builder.FilterButton`, `rendering.FilterButton` | a toggle: pressed while a SQL chip matches it, its chip labelled with its title |
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
  - **Adding:** the funnel in the title bar opens a new, empty SQL chip in edit mode at the end of the chips; Enter
    adds it (`add(text)`), Escape or an empty text drops it. The funnel's dot (marked while a SQL filter was set) goes:
    the chips show what is set. (proposed)
  - **Editing, the same for every chip** (proposed): a click on a chip's text puts it in edit mode in its place, one
    chip at a time. A SQL chip edits its text in a textarea (`d-field--mono`, Shift+Enter a new line); a structured
    chip edits its value in an input, and a click on its `=` / `≠` flips the op. Enter or leaving the field applies it
    (`replace(index, chip)`), Escape cancels it, an empty SQL text removes the chip. The URL changes once per applied
    edit, not per keystroke.
  - **Shown** while there is a chip, the page has buttons, or a chip is being added; on a page with `filterBar` only,
    as today.
- **A filter button shows as a chip while toggled on** (proposed): the chip is a plain SQL chip, its text the
  button's `queryPart` (the `...` filled in, as today); no new URL key. A pure function in `filters.ts`,
  `buttonOf(sql, buttons)`, gives the button a SQL chip's text matches: equal to its `queryPart`, or for a `queryPart`
  with `...` equal with a non-empty text in place of every `...` (`request__host = '...'` matches
  `request__host = 'app.wetell.de'`, the value `app.wetell.de`). Such a chip is labelled with the button's title
  (`Host: app.wetell.de`, `Errors only`), its SQL in its `title`. The button is pressed (`aria-pressed="true"`) while
  a chip matches it; pressing a pressed button removes every chip that matches it, pressing it otherwise adds its
  chip (asking for `...` as today). So a link with `?sql=status NOT BETWEEN 200 AND 399` opens with "Errors only"
  pressed, and editing a button's chip into other SQL makes it a plain SQL chip, the button released. A chip from
  a `...` button whose value contains the text around `...` (`'` inside `'...'`) may match no button; it stays a
  plain SQL chip.
- **The table cell menu** ("Filter: Contains this value", the timestamp entries) adds a SQL chip through `add(condition)`
  as before; each entry is now a chip of its own, removable alone.
- **The Explore view's tab** shows the same chips; how they apply to an edited query is the Perspective concept's
  (`docs/2026-10-30-perspective.md`, "Editable SQL").
- **Tests:** `query.test.ts` (two `sql` and `f` interleaved keep their order through `parseSearch` / `formatSearch`, a
  single old `sql` is one chip, `?sql=` none, `add(condition)` once, `replace`, `remove`), `filters.test.ts` (a SQL chip
  from the funnel, editing a SQL and a structured chip, Escape, `buttonOf` with and without `...`, a pressed button
  removes its chip), Go: `query_state_test.go` (several `sql`, an empty one), `time_range_test.go` (`SqlClause` with
  two chips). Playwright: `e2e/filter-chips.spec.ts` (a link with two `sql` shows two chips, the funnel adds one, × on
  one, a filter button toggles).

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
  showChoices(entries: { label: string; run(): void }[], o: { anchor: Element | {x: number; y: number}; title: string }): void;
                                          // a menu of the moment (a chart's candidates), drawn as a context menu;
                                          // no entries change nothing
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

// page — the open tabs and what each shows (§3.4.1)
interface PageApi {
  readonly workbench: WorkbenchJson;        // menu groups and outlines, from /workbench.json (generated type, §3.2)
  readonly tabs: readonly Tab[];            // {id, url, title}; activeTab, onDidChangeTabs, closeTab(id)
  readonly current: PageJson | undefined;   // the active tab's, from <url>/page.json (generated type); undefined while it loads or failed
  readonly onDidChangePage: Event<PageJson | undefined>;   // with `current`: another page, a failed one, every switch of tabs
  navigate(url: string, o?: { newTab?: boolean }): Promise<void>;   // fetch page.json, pushState, swap the tab's content
  registerPageRenderer(kind: string, render: (el: HTMLElement, page: PageJson, context: PageContext) => Disposable): Disposable;
}                                           // `dashboard` by the extension dashboardPage; a kind in the hash (`#explore=3`)

// query — the state every query depends on (§3.7)
interface QueryApi {
  readonly time: TimeModel;                 // range, auto refresh; per page, URL-synced
  readonly filters: FilterModel;            // chips: {fieldId, op, value} | {sql} (step 7b) + time window; URL-synced
  readonly params: ParamsModel;             // form widget values; URL-synced
  readonly cursor: CursorModel;             // hovered timestamp, synchronized across time charts (step 7)
  refresh(): void;
  readonly onDidRequestRefresh: Event<void>;
  requestParams(): URLSearchParams;         // what every data handler reads; one format with step 6
}

// widgets — renderers per widget type (§3.6)
interface WidgetsApi {
  registerWidget<T extends WidgetType>(type: T, render: (el: HTMLElement, w: WidgetOf<T>, ctx: WidgetContext) => Disposable): Disposable;
  readonly active: ActiveWidget | undefined;              // the active tab's active widget: Debug, the status bar (§3.4.4)
  readonly onDidChangeActive: Event<void>;
}
```

Menus open from a visible button ("…", or the widget's menu button), never by a right click: on the web nobody
expects one. Menu ids: `page/title` (page actions), `widget/context` (a chart's menu: debug), `widget/selection` (the floating bar
on a chart selection: zoom, filter, show rows, actions), `table/row` (a row's menu),
`dashboards/entry` (a menu entry: favorite), `table/cell` (a table cell's menu: its SQL filters) and `table/header` (a
column header's menu button: auto-size). **Deviation (2026-10-31):** `table/cell` opens on a right click, as the
cell's Tabulator menu did before it became a registered menu; Tabulator's own menus are gone. A table shows them through
`ctx.showMenu(menuId, anchor, context)`: the widget's `WidgetMenuContext` with the cell's (`TableCellMenuContext`:
column, value, timestamp, selecting) or the header's fields (`TableHeaderMenuContext`: column, `autoSize`,
`autoSizeAll`); Debug's result table through `ui.showContextMenu` with the cell's or header's alone. The `table`
extension contributes the entries (commands `table.filter…`, `table.autoSizeColumn(s)`). A menu of the moment needs no
id (reworked 2026-10-31): `ui.showChoices(entries, {anchor, title})` shows `{label, run}` entries in the same list,
one menu at a time with the registered ones (no entries leave the open menu, a registered menu without entries closes
it); a chart's candidates for a selection go through it
(`WidgetContext.choose`, §3.8 step 6.8).

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
| `debug` | left panel "Debug" (the active widget's query, stats, EXPLAIN, result, as views); the status bar's item (the active widget's status); `widget/context` "Debug" (§3.4.4) |
| `chart-link` | `widget/context` "Copy link to chart" (`/p/shop#w=3`) |
| `row-details` | `table/row` "Details" and `widget/selection` "Show rows" → a panel (its place open since the bottom panel is gone) |
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
| 7e ✅ | **the active widget** (§3.4.4): `widgets.active` / `onDidChangeActive` (`WidgetStatus` from `ctx.query()`), per tab, outlined; Debug as a left side panel of views following it, asking `/debug` only while shown; the status bar's item (title, rows, time, error, ignored filters), a click opens Debug; the bottom panel removed; `e2e/active-widget.spec.ts`. ✅ 2026-10-31 (vitest, typecheck, top comments green; Playwright written, not run), deviations: the innermost widget with data becomes active; no `setActive` (the menu button's press activates); the query time is measured in the browser; the status bar always shows ("No active chart"); Debug's Stats view also holds the ClickHouse summary (the old "Clickhouse Summary (Legacy)" section) *(all proposed)* | the active chart in Debug and the status bar |
| 7e.1 ✅ | **review fix: overlapping queries** (§3.4.4): a per-widget count of `query()` calls; only the latest sets the status and `lastResult`, an aborted latest one puts back the last answer's status (not the one seen at its start, which may be an earlier call's `loading`). Before, an aborted query's late rejection put an old "done" over the newer query's `loading`, and Debug asked `/debug` twice. ✅ 2026-10-31 (vitest: two overlapping queries, the first aborted) | a refresh during a load shows "querying…" |
| 7e.2 ✅ | **review fix: Debug and records** (§3.4.4): Debug remembers the status it asked `/debug` for and asks again only for another widget or another status, so ticking rows (which fires `onDidChangeActive`, step 7f) no longer refetches and redraws it (scroll, the Result table, the pipeline graph kept). ✅ 2026-10-31 (vitest) | ticking rows keeps Debug as it is |
| 7f ✅ | **selected records** (§3.4.5): `ctx.selectRecords`, `ActiveWidget.records` (`WidgetRecord`), told by `onDidChangeActive`; the table's ticked rows, its checkbox column only with `selectRecords`, cleared on each draw; the in-table details panel (full screen, close) and its CSS removed; the `details` extension: the left side panel "Details" (a view per record, `renderRecordDetails`' formatting as `drawRecord`), the status bar's "N records selected"; `widgetTitle` moved from Debug into the `widgets` host; `e2e/record-details.spec.ts`. ✅ 2026-10-31 (vitest, typecheck, top comments green; Playwright written, not run), deviations: records in the order ticked; a redraw (also another width) drops them; Debug's result table has no checkboxes; collapsed state per record place in `workspaceState`; the search highlight leaves the details *(all proposed)* | a table's ticked rows in Details and the status bar |
| 7f.1 ✅ | **review fix: Details' record views** (§3.4.2, §3.4.5): `createView`'s `state` is optional (without it nothing is kept); Details passes none, so every record view starts open instead of taking the state stored under `record.<index>` from another table or selection. ✅ 2026-10-31 (vitest) | closing a record of one table leaves the others open |
| 7f.2 ✅ | **review fix: comment wrap** (§3.10): the top comments and tests' headers where steps 7a–7f inserted text without re-wrapping (`dashboards`, its tests, `table` tests, `window-layout`, `ui`, `widgets-testing`) are wrapped to 120 columns again; wording unchanged. ✅ 2026-10-31 | — |
| 7+ | each planned when we get there: time selection + synchronized cursor, Go actions | |

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
  change a query; the SQL chips are client-sent SQL, in one repeatable parameter (`sql`), parsed in one place, as is
  the Explore view's edited query (`xsql`, Perspective concept, behind `explore.enabled`), so both can be limited to
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
10. **The kind `explore`** (tabs, §3.4.1): the Explore view's tab is the kind `explore`, named in the hash. Is the
    Explore rebuild of §6 (`page.kind === 'explore'`) that same view grown (widget tree, inspector), or a kind of its own?
