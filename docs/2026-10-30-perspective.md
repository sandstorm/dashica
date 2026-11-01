# Perspective for the Explore view (technical concept)

Status: **draft (2026-10-30); simplified (2026-10-31, after the maintainer's notes); built as a spike on branch
`spike/perspective`, not yet run in a browser: see §8. Decided 2026-10-31: the view shows the chart's materialized SQL
in an editor, and an edited query runs as it is written; this replaces "Remove grouping" (§4.7). Decided 2026-10-31
as well (§4.8, workbench §3.14 D8–D13): placeholders instead of literals, `exploreSql`, Explore off means off (✅ built
2026-10-31, step 8g; the Schema view in step 8h; a global "Explore" without a chart in step 8i; the settings panel
open and Reset asking in step 8k; CodeMirror in step 9d of the workbench, 2026-10-31).**

Builds on the workbench concept (`docs/2026-10-28-workbench.md`: §3.8 selections, §6 "Explore rebuilt", "drill to
detail", "Perspective instead of the Tabulator table").

## 1. Context and goal

[Perspective](https://perspective-dev.github.io/) is a WebAssembly data grid, pivot engine and chart viewer. It reads
Apache Arrow, which every Dashica data handler already returns.

**Goal: an Explore view for every chart.** "Open in Explore view" on a chart or table opens **the chart's own query, as
the chart runs it** (its result: what the chart drew) in Perspective, rebuilt as the chart (a time bar with `fill:
status` opens as a bar chart over time, split by `status`). From there the user regroups, filters and switches to a
grid, without writing Go or SQL. Beyond that, **the view shows the chart's SQL as it runs** (the time range and the
filters written in, its ClickHouse parameter placeholders kept and their values beside it, since step 8g) in an editor;
the user changes it freely (drops the `GROUP BY`, selects other columns) and runs it, read-only and at most 100,000
rows, when Explore is enabled (§4.7, decided 2026-10-31). Until 2026-10-31 a toggle "Remove grouping" asked Go for the
chart's query without its grouping; the editor replaces it.

This concept answers:

1. What the Explore view shows: the chart's query, and the SQL the user edits from it (§4.1, §4.7).
2. Who may run edited SQL: only when Explore is enabled, read-only; permissions later (§4.7).
3. How a chart's props (`x`, `y`, `fill`, …) become Perspective's initial viewer config (§4.2).
4. Where Perspective runs: in the browser (§4.3).
5. What happens to the table widget (Tabulator) and the charts (Observable Plot): **both stay** (§4.6).

Fixed: ClickHouse credentials never reach the browser. **Reversed 2026-10-31:** the client sends SQL for the Explore
view, the edited query (`exploreSql`, §4.7, §4.8), beside the page's SQL chips (`sql=`); Go runs it with the chart's
ClickHouse connection, read-only. Guiding principle (maintainer): the least machinery that still behaves nicely.

## 2. Current state

### 2.1 Data path

| Step | Where | What |
|---|---|---|
| Query | `lib/httpserver/query_new.go`, `QueryHandler.HandleQuery` | builds SQL from the widget's `sql.SqlQueryable`; unless the query says `ShouldSkipFilters()`, appends `filters.SqlClause(timeRange)` as one more WHERE (`timestamp >= … AND timestamp <= …` plus free SQL); rebakes auto buckets; ClickHouse answers in Arrow (`output_format_arrow_compression_method=none`) |
| Filters | `lib/dashboard/widget/widget_common.go`, `queryHandler` | the page's pills (`f`) on the chart's table (since workbench step 8e: `filter.Apply`, each pill a condition the server wrote and signed, `(replace(customer_project, …)) = 'acme'`, workbench concept §3.8) |
| Headers | same | `X-Dashica-Resolved-Time-Range`, `X-Dashica-Bucket-Size` (only when the query has an `AutoBucket` field), `X-Dashica-Diagnostics`, `X-Clickhouse-Summary`, `X-Dashica-Alert-If` |
| Fetch | `frontend/hosts/widgets/widgets-impl.ts`, `fetchQueryResult` | `Arrow.tableFromIPC(response)` into an `apache-arrow` `Table` |

The time filter assumes a column `timestamp` on every filtered query (`httpserver.TimeClause`). ClickHouse credentials
live only on the server (`dashica_config*.yaml`).

### 2.2 What a query knows about its grouping

| Query kind | Knows | Count in the deployed instance (`../src/**`) |
|---|---|---|
| Builder, `sql.New(...)` (`lib/dashboard/sql/sql_builder.go`) | `from`, `where`, `database`, and separately `selectF`, `groupBy`, `orderBy`, `limit`, `fillStep`. Dropping the last five leaves the original rows | 51 base queries |
| SQL file, `sql.FromFile(...)` / `sql.FromFileWithoutFilters(...)` (`from_file.go`) | path, extra `where` (substituted into `{{DASHICA_FILTERS}}`), `database`. Base table, grouping and the file's own WHERE sit inside the SQL text | 62 queries: 48 `FromFile`, 14 `FromFileWithoutFilters` |
| `sql.FromString` | as SQL file | 0 |

A chart's `Query()` is the full query it runs: the widget adds its fields to the base query (`TimeBar`:
`sql.PrependSelect(b.x)`, `sql.GroupBy(b.x)`, the same for `fill`, `fx`, `fy`; `lib/dashboard/widget/time_bar.go`).

### 2.3 What chart props carry

Chart fields are `sql.SqlField`s, sent in `page.json` props as `{kind, alias, xBucketSizeMs?}`
(`sql.MarshalFieldProps`). `kind` is `count`, `enum`, `autoBucket` or `expr`. The aliases are the column names of the
chart's result. Which slot is the measure is fixed per widget type:

| Widget (uses) | Dimensions | Measure |
|---|---|---|
| `timeBar` (84) | `x` (time), `fill`, `fx`, `fy` | `y` |
| `table` (48) | all result columns | — |
| `barVertical` (28) | `x`, `fill`, `fx`, `fy` | `y` |
| `stats` (16) | `titleField` | `fillField` (a CSS color) |
| `timeLine` (7) | `x` (time), `strokeField`, `zField`, `fx`, `fy` | `y` |
| `barHorizontal` (7) | `y`, `fill` | `x` |
| `timeHeatmap` / `…Ordinal` (7) | `x` (time), `y` | `fill` |

### 2.4 Table widget and charts

- Table: `frontend/extensions/chart-library/table.ts` (846 lines, Tabulator 6) with Dashica's own features: search
  with highlights (CSS Custom Highlight API), header filters, pinnable sticky tooltips with JSON pretty print, record
  details, cell menu "Filter: equals / not equals / contains" to page filters. Default `limit` 10,000 rows. Used in 48
  widgets; works well.
- Charts: Observable Plot in `frontend/extensions/{time-bar,time-line,heatmap,bar-vertical,bar-horizontal,stats}`,
  time brush via `chart-library/time-brush.ts`. Look, marks, colors and alert thresholds declared in Go. Work well.

### 2.5 Explore and bundle

- `lib/explore` is deprecated, its UI is gone; the workbench concept (§6) rebuilds Explore as a page with a widget
  builder. Its Go state in `dashica.go` (`exploreBaseURL`, the `IsExploreView()` marker) is deprecated as well.
- `lib/explore`'s preview (`preview/query`) ran a widget the browser sent as JSON through the same
  `widget.DataHandler` as a mounted chart, including a query of kind `raw` (`sql.FromString`): SQL from the browser,
  without `explore.enabled`. It is deleted (workbench step 9aw), with `lib/explore`'s `schema` and `values`.
- `public/dist/index.js`: 3.9 MB unminified, ~1.1 MB gzipped, one esbuild entry. Speedscope is a separate build served
  per widget: precedent for a heavy viewer outside the main bundle.

## 3. Perspective today (researched 2026-10-30, v5.6.1)

| Topic | Finding |
|---|---|
| License, home | Apache-2.0; OpenJS Foundation project, packages `@perspective-dev/*` |
| Activity | v5.0.0 on 2026-07-28, v5.6.1 on 2026-10-23: frequent releases and frequent breaking changes (v5: `load()` takes a `Client`, workspace removed, `viewer-d3fc` replaced by `viewer-charts`, CSS variables renamed to `--psp-*`) |
| Packages | `@perspective-dev/client` (engine API), `@perspective-dev/server` (engine as wasm, in a Web Worker), `@perspective-dev/viewer` (`<perspective-viewer>`, Rust/wasm), plugins `viewer-datagrid` and `viewer-charts` (WebGL; "Y Bar", "X Bar", "Y Line", "Heatmap", …) |
| Size | `perspective-server.wasm` 2.6 MB, `perspective-viewer.wasm` 1.65 MB, `perspective-js.wasm` 0.63 MB, JS ~0.55 MB: **~5.4 MB**, little gzip gain (viewer wasm ships compressed). Roughly 5× today's gzipped bundle |
| Memory | wasm32: one engine has at most 4 GB of linear memory, in practice a few million narrow rows per browser tab; wide log rows (message, JSON attributes) far fewer |
| Arrow input | `client.table(arrayBuffer)` and `table.replace(bytes)` take Arrow IPC bytes |
| Viewer config | `viewer.restore({table, plugin, columns, group_by, split_by, aggregates, filter, sort, expressions, plugin_config})`, `viewer.save()`; events `perspective-click` (`detail.config.filter`, `detail.row`), `perspective-config-update` |
| Theme | CSS custom properties `--psp-*` in the viewer's theme files (`defaults.css`, `themes.css`, `pro.css`, `pro-dark.css`, …) [2] |
| Virtual server | (v5) the viewer's group / split / filter / sort / aggregate can run in an external engine through a handler [1]; built-in handlers exist for DuckDB, ClickHouse (JS in the browser, with credentials there) and PostgreSQL [1, 3]. Not used here (§4.3) |
| Fit | one large exploratory view on 10k-10M rows; each viewer has its own shadow DOM and settings panel; chart look is set in the viewer, not declared |

### Sources

Checked 2026-10-30.

1. Virtual servers guide: <https://perspective-dev.github.io/guide/explanation/virtual_servers.html>
2. Theme files: <https://github.com/perspective-dev/perspective/tree/master/rust/perspective-viewer/src/themes>
3. ClickHouse handler guide (JS): <https://perspective-dev.github.io/guide/how_to/javascript/virtual_server/clickhouse.html>

## 4. Proposed solution

**Recommendation (2026-10-31, after the maintainer's notes): one Explore view on Perspective in the browser, opened from
any chart, on the chart's own query as the chart runs it, only with Explore enabled. The view shows that query's SQL in
an editor, its parameters beside it; an edited query runs as written, read-only, at most 100,000 rows (§4.7). Tabulator
and Plot stay.**

```
 dashboard chart               Go (the chart's handler)                Explore view (lazy bundle)
 ┌──────────────┐ "Open in    ┌──────────────────────────────────┐    ┌───────────────────────────────┐
 │ timeBar      │  Explore    │ GET <dataUrl>/rows               │    │ <perspective-viewer>          │
 │ x=AutoBucket │  view" ────▶│  the chart's query as at /query  │───▶│  initial config from props    │
 │ y=Count      │  + Query-   │ GET <dataUrl>/sql                │Arrow│  group / split / filter local │
 │ fill=status  │  State      │  that query + parameters (JSON)  │    │  SQL editor: Run, Reset       │
 └──────────────┘             │ GET <dataUrl>/rows?exploreSql=…  │    └───────────────────────────────┘
                              │  the edited text and parameters, │
                              │  read-only, ≤ 100000 rows        │
                              └──────────────────────────────────┘
```

### 4.1 What the view shows: the chart's query, and without its grouping

**Superseded 2026-10-31 in part:** the bullets "Without grouping", "SQL files", "Gate" and "The gate and the free SQL
filter" describe the spike's "Remove grouping" (`?grouping=none`, `sql.Ungrouped`), which the SQL editor replaces
(§4.7). "The chart's result" stays as it is; "No selection" now holds for an edited query.

- **The chart's result** (the start): `GET <dataUrl>/rows` answers the chart's query exactly as `/query` does: the same
  `applyFilters`, time range, free SQL filter, params, auto buckets. Its columns are the chart's aliases, the data is
  what the chart drew, aggregated. Every chart has it, builder or SQL file; it serves nothing `/query` does not, so it
  needs no gate.
- **Without grouping** (the toolbar toggle "Remove grouping"): `GET <dataUrl>/rows?grouping=none` answers
  `sql.Ungrouped(<the chart's query with the page's filters>, 100000)`: the same `FROM`, `WHERE` (the query's own, the
  filters' as the chart interprets them, so a filter on `customer_project` of `caddy_ingress.go` compares the replaced
  value as the chart does), database, time range, free SQL filter and params; `SELECT *`, the original columns of the
  table; no `GROUP BY`, no aggregates, no `ORDER BY` or `WITH FILL` of the chart; `ORDER BY timestamp DESC` when the
  query takes the time range (`!ShouldSkipFilters()`: the time filter needs `timestamp`, §2.1), else ClickHouse's
  order; `LIMIT 100000`. These rows are the original data: no re-selected dimension definitions, no `* EXCEPT`, no
  alias handling. A dimension computed in SQL (`replace(customer_project, …) AS customer_project`) shows as the raw
  column; regrouping by it in the view groups the raw values.
- **SQL files:** their grouping is inside their text and cannot be derived; for them the view offers the chart's result
  only (no toggle). Changing a query's SQL in the view is the next step (§6, §7 question 2), not part of this one.
- **Gate (sensitive raw data):** rows without grouping are served only when Explore is enabled: `explore.enabled: true`
  in `dashica_config*.yaml` (env `EXPLORE__ENABLED=true`), default off. The value reaches the chart's handler where it
  is built (the config injected as `rendering.Dependencies.Config`, since step 9v); with it off, or for a SQL
  file, `grouping=none` answers 404 and the answer has no `X-Dashica-Grouping`, so the view shows no toggle.
  Permissions per viewer come later and replace the flag by a per-request decision at the same place.
- **The gate and the free SQL filter:** the gate decides which rows `/rows` serves. The page's free SQL filter (`sql=`)
  goes with every request, `grouping=none` included, and is SQL from the client: without grouping it sees the raw
  columns, and on any chart, Explore off, it can already ask about raw columns through `/query` (subqueries included).
  It keeps its existing trust model (all authenticated users are trusted); permissions later cover both. Since step
  9a of the workbench concept (§3.15 D16) it runs only with `filters.sqlEnabled`; off, a `sql=` is a 400 wherever it
  would enter a query (`QueryState.SqlClause`, since step 9v).
- **No selection from the rows without grouping:** a click on one of their group rows offers no "Filter by" /
  "Exclude". Their columns are raw, and a page filter on a column the chart also computes as a dimension (Caddy's
  `customer_project`) filters on the dimension's definition, which the raw value (`sandstorm.shop`) does not match:
  the chart, the view and every chart with that dimension would go empty.

### 4.2 Initial viewer config from the chart's props

A TS function per widget type in the Explore extension (`mapping.ts`) maps props to `viewer.restore(...)` on the
chart's result. The aliases are the result's columns, so the mapping is direct: no `bucket()` of raw timestamps, the
time axis is the chart's bucketed column.

| Widget | `plugin` | `group_by` | `split_by` | `columns` / `aggregates` |
|---|---|---|---|---|
| `timeBar` | Y Bar | `x`, then `fx`, `fy` | `fill` | `y` |
| `timeLine` | Y Line | `x`, then `fx`, `fy` | `strokeField` or `zField` | `y` |
| `barVertical` | Y Bar | `x`, then `fx`, `fy` | `fill` | `y` |
| `barHorizontal` | X Bar | `y` | `fill` | `x` |
| `timeHeatmap` / `…Ordinal` | Heatmap | `x` | `y` | `fill` |
| `stats` | Datagrid | `titleField` | — | all columns |
| `table` | Datagrid | — | — | all columns |

- **Measures:** a `count` sums (Perspective's group totals add up the chart's counts), any other measure takes `last`
  (one result row per group already).
- **A dimension missing from the result** (a SQL file whose columns differ from the props): left out, with a note.
- **An edited query** (§4.7; was: without grouping): the mapping above when every column it names is in the answer,
  else a plain datagrid of all columns; the user groups from there.

### 4.3 Where Perspective runs

**Plain browser (maintainer, 2026-10-31).** Perspective's engine runs as wasm in a Web Worker on the Arrow rows Go
serves: no new runtime, Go builds the only SQL, interaction is instant, credentials stay on the server. Against it: the
rows without grouping are a truncated extract (the newest 100,000 of the window), ~5 MB first load, memory per tab.
Pushing grouping down to ClickHouse (a virtual-server handler, a server-side Perspective, Perspective's own ClickHouse
handler) is not planned.

### 4.4 The Explore view

- **Entry:** `ui.registerMenuItem('widget/context', { command: 'exploreView.openWidget', title: 'Open in Explore
  view', group: 'data' })` for charts (`rowsUrl` in the widget's node), only while `workbench.json` says `explore`
  (explore.enabled; since step 8g, §4.8 D8); else the extension registers only "Explore (from scratch)" greyed in the
  global menu. With Explore on, the global menu's "Explore (from scratch)" and "Explore (from chart…)" open a blank Explore, the same view without a
  chart (`#explore=&connection=<name>`, §4.8 D10).
- **Place** (a tab since 2026-10-31, workbench §3.4.1, step 7a): a new tab of the page kind `explore`, named in its
  hash; its URL is the source tab's with `#explore=<id>` (the id of the chart's `dataUrl`), so it starts with a copy of
  that tab's query state and a link or a reload opens it again. The top bar (time picker, refresh) and the filter
  bar show the Explore tab's state and refresh it (`table.replace(bytes)`, the viewer keeps its config); the
  dashboard's tab keeps its own. The tab is titled "Explore: <chart title>"; Back shows the dashboard's tab, "Close"
  closes the Explore tab. A hash naming a chart the page lacks (or one without rows) shows "<page> has no chart <id>
  to explore" in the tab. Before: the dashboard's hash, laid over the content by `UiApi.showOverContent` (gone).
- **Toolbar:** title, "n rows of the chart's result" / "the first n rows (limit)" (an edited query), the filters the
  chart ignores, "SQL" (closes and opens the SQL editor, §4.7; since step 8g always there, as the view only exists with
  Explore enabled), "Reset" (asks first, §4.8 D13), "Close". "Remove grouping" goes (§4.7). The viewer opens with its
  settings panel open (§4.8 D13).
- **Filters from the view:** `perspective-click` on a group row gives `[[column, '==', value], …]`; the deepest such
  value on a column that is no date or time is offered in the quick pick "Filter" at the click (since workbench step
  8c, "Filter" / "Exclude"; since step 9f the `filters` extension's command `filters.offer`), which adds a page filter chip at once (all rows re-fetched); on
  the chart's result only, an edited query's rows offer nothing (§4.7). Perspective's own filters stay local.
- **State:** `viewer.save()` per chart and mode in the extension's `globalState` (localStorage), keys `view:<dataUrl>`
  and `view:<dataUrl>:edited` (was `:ungrouped`), kept once the viewer was used, without `settings` (the panel opens
  every time, §4.8 D13); "Reset", once confirmed, goes back to the config from props. The edited SQL itself is in the tab's hash (§4.7).
- **Loading:** a second esbuild entry, `public/dist/perspective.js` + `perspective.css` and its wasm files, `import()`ed
  by URL on first use; dashboards load none of it.
- **Theme:** `explore-view.css` maps `--psp-*` onto `frontend/core/style/tokens.css`, light and dark.

### 4.5 HTTP contract

Since 2026-10-31 (§4.7; proposed where §4.7 says so):

| Request | Answer |
|---|---|
| `GET <dataUrl>/rows?<QueryState>` | the chart's query as at `/query`, Arrow with every column of a plain Arrow type (`clickhouse.PlainArrowCast`: `DateTime*` → `DateTime64(3)`, `Date` → `Date32`, 64-bit+ ints / `Decimal` / `BFloat16` → `Float64`, others → `String`); headers `X-Dashica-Resolved-Time-Range`, `X-Dashica-Bucket-Size`, `X-Dashica-Diagnostics` (`X-Dashica-Sql: editable`, which replaced `X-Dashica-Grouping: removable`, went with step 8g) |
| `GET <dataUrl>/sql?<QueryState>` | JSON `httpserver.ChartSql` `{sql, parameters}` (since step 8g): the chart's query as `/query` sends it to ClickHouse for this state, its `{name:Type}` placeholders kept, and the values bound to them (`__from`, `__to`, the form values); `X-Dashica-Diagnostics`; 404 when Explore is off (`HandleSql` checks it) |
| `GET <dataUrl>/rows?exploreSql=<text>&param_<name>=<value>…` | `<text>` run as it is on the chart's ClickHouse connection, each `param_<name>` bound to its placeholder (`EditedParameters`, ClickHouse's HTTP names), read-only, the same casts, at most 100,000 rows; header `X-Dashica-Rows-Limit: 100000`; no QueryState read; 404 when Explore is off (`HandleEditedRows` checks it) |
| any | 204 for a skipped chart (`X-Dashica-Diagnostics`; not for `exploreSql`), 400 for an unreadable query state, 500 for a ClickHouse error with ClickHouse's message (`Code: 62. DB::Exception: Syntax error …`) |

`?grouping=none` and `X-Dashica-Grouping` go.

`page.json` names `rowsUrl` (`<dataUrl>/rows`) on every chart.

### 4.6 Table widget and charts stay

- **Table widget (Tabulator) stays.** Its value is Dashica's own features (§2.4), which would be rebuilt against
  Perspective's datagrid plugin API inside a shadow root; a log table is read, not pivoted; ~5 MB per table page.
  **Revisit when** the Explore view is in regular use, users read logs there instead of in the table, *and*
  Perspective's datagrid API has stayed stable across two majors; or when Tabulator stops being maintained.
- **Charts (Plot) stay.** Dashboard charts are declared in Go (marks, colors, thresholds, bucket size, brush), small
  and many per page (5-20); Perspective charts are configured in the viewer, WebGL per chart. **Revisit when**
  dashboards need interactive regrouping in place.

### 4.7 Editable SQL (decided 2026-10-31; ✅ built 2026-10-31, deviations in §6 step 4)

*Step 8g (§4.8, ✅ 2026-10-31) changed this section: the editor shows the chart's parameter placeholders, not their
values, which are listed beside it and sent again on Run, and `InlineParameters` is gone (D9); `xsql` is `exploreSql`
(D9); the handlers check Explore themselves, and the view exists only with Explore enabled (D8). Since workbench step 9d the textarea
is CodeMirror (D12). The maintainer's quote below is the decision before; D9 reverses it for the parameters.*

Maintainer: "EXPLORE IS SHOWING THE MATERIALIZED SQL AND PEOPLE CAN START ADJUSTING IT FULLY ... SO NOT
DASHICA_FILTERS PLACEHOLDER". The Explore view gets a SQL editor, prefilled with **the chart's query exactly as it
runs**: its window, the page's filters (structured and SQL chips), the form values, its auto buckets, all written
in as literals, without `{{DASHICA_FILTERS}}` and without a `{name:Type}` placeholder. The user edits it freely and
runs it. "Remove grouping" is then just editing the SQL (delete the `GROUP BY`, select `*`), so the toggle goes, and
with it the gap it had: SQL-file charts had no toggle, now every chart, builder or SQL file, has the editor.

**Two states, read from the tab's URL** (proposed: the least state that survives a reload):

| State | Tab's hash | The editor shows | Run / refresh | Page's time range and chips |
|---|---|---|---|---|
| following | `#explore=3` | `GET <dataUrl>/sql?<QueryState>`'s SQL, its parameters beside it, fetched again on every refresh (`onDidRequestRefresh`: time, chips, params, the refresh button, auto refresh) | the view shows `/rows?<QueryState>`, the chart's result, as today | apply, fetched again on every change |
| edited | `#explore=3&exploreSql=<text>&param_<name>=<value>…` | `<text>`, the hash's parameters beside it | `/rows?exploreSql=<text>&param_…`, again on every refresh | do not apply |

- **"Edited" means: the tab's hash has `exploreSql`.** Run (button, or Cmd / Ctrl+Enter in the editor) puts the editor's
  text and the parameters listed (the edited query's, else the chart's as fetched last) into the hash with
  `page.navigate(<tab URL>#explore=3&exploreSql=<text>&param_<name>=<value>…)` (`editedQueryKeys`, since step 8g): a
  hash change of the active tab, so the page host pushes a history entry and fires `context.onDidChangeHash`, and does
  not render the tab anew (its renderer is named by `explore=3`, which stays). Run on a text equal to the chart's SQL as
  fetched last removes `exploreSql` and the parameters (nothing is edited). **"Reset to the chart's query"** (shown
  while edited) navigates to `#explore=3`. Back undoes a Run or a Reset; a reload or a shared link opens the edited
  query again. The hash, not `?exploreSql=` in the query string: the query host and `page.json` loads look at the search
  only, so nothing else needs to know the key, and a long SQL text never goes to the server with the shell's request
  (proposed).
- **A draft** (typed, not run) is the editor's text only: while it differs from the chart's SQL fetched last, a refresh
  does not overwrite it, and the editor's note says "not run" (proposed).
- **The view says so while edited:** a note above the viewer, "Edited query: the page's time range and filters do
  not apply", and the button "Reset to the chart's query". The top bar and filter bar stay as they are (the chips
  still apply to the dashboard's tab, and to this one after Reset).
- **The editor:** (since workbench step 9d CodeMirror, §4.8 D12; until then:) a plain `<textarea>` (`d-field d-field--full d-field--mono`, as the filter bar's SQL field was): the
  repository has no code editor (no CodeMirror, Monaco or the old Explore's editor in `package.json` or
  `frontend/`). A panel above the viewer, open from the start (since 2026-10-31: behind a button nobody found it); the
  toolbar's "SQL" (`aria-pressed`) closes and opens it, and it opens by itself while edited (proposed). (Since step 8g
  there is no view with Explore off, so no "SQL editing is off" note.) The parameters' values are a list beside the
  text (`<dl>`, `{name}` and its value), read-only. Highlighting later, if the plain field is not enough.
- **The split between the SQL panel and the viewer** (workbench step 9av, D48, decided 2026-11-01; maintainer: "this
  separator needs to be resizable..."): the line below the SQL panel (editor, parameters, Run) is a horizontal sash
  (`Sash`, `frontend/core/sash`, workbench §3.5), as the side bars' edges. Dragging it, or ArrowUp / ArrowDown on it
  (a line, 19 px, per key), sets the panel's height; the editor fills what Run leaves of it and scrolls inside, the
  parameters' list scrolls beside it, the viewer takes the rest. The height (96 to 2000 px, at first 216 px: about
  the eight lines that were the editor's minimum) is kept for this viewer in the extension's `globalState`
  (`sqlHeight`); the sash hides with the panel. The stylesheet keeps at least 160 px of the view for the viewer
  (`max-height` on the panel), and a drag starts from the height shown, so a height kept from a taller window does
  not make the first part of a drag do nothing *(proposed)*. The old sizing (at least eight lines, at most half the
  view's height, growing with the text) is gone.
- **Selection and viewer config:** an edited query's rows select nothing (no "Filter by": its columns are whatever
  the text selects, and a page chip would not change the edited query anyway). The first viewer config of an edited
  answer is the chart's mapping (§4.2) when every column it names is in the answer, else a plain datagrid of all
  columns; kept per chart under `view:<dataUrl>:edited` (proposed).

**The chart's SQL, in Go** (`GET <dataUrl>/sql`, since step 8g, D9): the `/sql` handler is `queryHandler`'s `serve`
as for `/query` (ParseQueryState, the pills on its table), then `HandleSql`, which checks `explore.enabled` (`QueryHandler.Config`)
first (`ErrExploreNotEnabled`, a 404, before any query), then `prepare` as for `/query`, which already gives the SQL
text (`p.query`: the window and the page's filters written in, `{{DASHICA_FILTERS}}` filled, the auto buckets
rebaked) and every value bound to it (`p.opts.Parameters`: `__from`, `__to`, the form values), and answers both as
the JSON of `httpserver.ChartSql` `{sql, parameters}` (in the generated TS contract). No round trip through `/debug`
or ClickHouse; the window is resolved once at the server's now, as for `/query`. The transport's casts
(`ensureArrowCompatible`, `PlainArrowCast`) and settings are not part of the text: Run applies them again (below).
The values never become SQL: Run sends them back as parameters, which ClickHouse binds itself, so no escaping of
Dashica's own is needed (`InlineParameters`, built in step 4, is gone).

*History, replaced by step 8g:* until 8g `/sql` answered `text/plain`, every placeholder written in as a literal by
`clickhouse.InlineParameters` (a lexer skipping literals, identifiers and comments; values decoded as ClickHouse reads
a bound parameter, then quoted with `\` and `'` escaped; typed placeholders as `CAST`, `DateTime*` as
`parseDateTime64BestEffort`).

**Running an edited query** (`GET <dataUrl>/rows?exploreSql=<text>&param_<name>=<value>…`,
`QueryHandler.HandleEditedRows(queryObj, text, params, limit, w, r)` in `lib/httpserver/rows.go`): before `serve`, the
`/rows` handler sees `exploreSql` and calls it with the request's `param_<name>` values (`EditedParameters`); it checks
`explore.enabled` first (`ErrExploreNotEnabled`, a 404, before any query), binds the values to the text's placeholders,
and runs the text on the chart's ClickHouse connection (`query.Database()`, so a connection limited to some dashboards
by `query_file_patterns` stays so); the request's QueryState is not read. It sends the text as it is, after trimming
spaces and one trailing `;`:

- **read-only:** `Client.Query` asks ClickHouse with HTTP GET, which ClickHouse runs read-only (`readonly=2` unless the
  user's profile is stricter); the handler also sets `readonly=2` in the query's settings, so the intent is in the
  code. ClickHouse then refuses `INSERT`, `ALTER`, `DROP`, `CREATE` and `SET readonly = 0` with `READONLY` (code 164).
  **To check** on 26.10 (`clickhouse local`, then an integration test against CI's ClickHouse): an `INSERT`, a
  `CREATE TABLE` and a `SETTINGS readonly = 0` clause each fail with code 164. All authenticated users are trusted
  (the instance's trust model); read-only and `explore.enabled` still apply.
- **the row limit:** a `LIMIT` around the text, `SELECT * FROM (\n<text>\n) LIMIT 100000` (`limited` in `rows.go`):
  exactly that many rows at most, without an error; the text's own `SETTINGS` cannot lift it (`readonly=2` lets the
  text change settings, so `max_result_rows` could be set back to 0), and its subqueries run in full
  (`max_result_rows` with `break` is also checked for subqueries, which could cut an `IN` set without an error). The
  text on lines of its own, so a trailing `-- comment` ends before the `)`. The header `X-Dashica-Rows-Limit: 100000`
  lets the toolbar say "the first n rows (limit)" when as many came. A `LIMIT` the user writes is theirs. (Changed
  2026-10-31 from `max_result_rows` with `result_overflow_mode=break`, after review.)
- **the same transport:** `output_format_arrow_compression_method=none`, `date_time_input_format=best_effort`,
  `PlainArrowCast` (which describes the query and wraps it in a cast `SELECT`): so a `FORMAT` clause in the text fails
  (as a syntax error of the wrapped query), shown as below.
- **Errors shown:** a ClickHouse error answers 500 with ClickHouse's message (`unsuccessful clickhouse response (status
  400): Code: 62. DB::Exception: Syntax error: …`, `UNKNOWN_IDENTIFIER`, `READONLY`, `TIMEOUT_EXCEEDED`); the view shows
  it in place of the viewer, in `d-notice d-notice--error`, and keeps the editor with the text, so the user fixes
  and runs again. A 404 (Explore turned off since) says "Explore is not enabled". The same for `/sql`: its error shows
  in the editor's place.
- **Gate** (since step 8g, D8): `HandleSql` and `HandleEditedRows` check `explore.enabled` themselves, in the config
  `QueryHandler.Config` (injected from `rendering.Dependencies.Config`, since step 9v), and answer `ErrExploreNotEnabled`, which `httpError` makes a
  404, before any query. `/rows` without `exploreSql` is the chart's result as before and stays ungated. The client
  learns the flag from `workbench.json` (`explore`) and leaves the view out without it, so no header tells it
  (`X-Dashica-Sql` and the `editable` wrapper in `widget_common.go`, built in step 4, are gone).

**What goes** (nothing else uses it, checked 2026-10-31): `sql.Ungrouped` and its tests (`lib/dashboard/sql`),
`grouping` / `withoutGrouping` / the `grouping=none` branch in `widget_common.go` and their tests in `rows_test.go`,
`X-Dashica-Grouping`, the `TestHandleRows_*` case without grouping, the view's `#ungrouped` / "Remove grouping" /
`rowsRequest(…, ungrouped)` / `RowsAnswer.groupingRemovable` / mapping kind `ungrouped`, and the "Remove grouping" test
of `e2e/explore-view.spec.ts`. `exploreRowLimit` stays, now the edited query's limit.

**Files** (step 4, then step 8g): `lib/httpserver/rows.go` (`HandleEditedRows`, `EditedParameters`,
`ErrExploreNotEnabled`), `lib/httpserver/query_new.go` (`HandleSql`, `ChartSql`, `QueryHandler.Config`),
`lib/dashboard/widget/widget_common.go` (`/sql`, `exploreSql`, `httpError`'s 404) and `rows_test.go`,
`lib/config/config.go` (comment), `dashica.go` (`WorkbenchJson.Explore`), `lib/dashboard/sql/ungrouped*.go` and
`lib/clickhouse/inline_parameters.go` (+ test, deleted), `frontend/extensions/explore-view/**`,
`e2e/explore-view.spec.ts`. Contract: `workbench.json`'s `explore` and `ChartSql` are generated into the TS types
(`go generate`, `TestContract_Golden`).

**Tests:** Go without ClickHouse: `EditedParameters` (only `param_` keys with a name, the first value);
`HandleSql` and `HandleEditedRows` answer `ErrExploreNotEnabled` with no ClickHouse manager (so before any query);
`/sql` of a builder chart and a SQL-file chart with a pill, a SQL chip and a form value (the filters written in, the
parameters in the answer), a chart's own placeholder kept; 404 for `/sql` and `exploreSql` with Explore off;
`workbench.json`'s `explore`. Against CI's ClickHouse (`rows_e2e_test.go`, blocked in the sandbox): the chart's SQL
with its parameters, run as an edited query, gives the chart's rows; a value with `\n`, `\t`, `\\` and `'`, a
`DateTime64` with a time zone and a `Nullable` NULL sent again as parameters answer what the chart binds;
`exploreSql` refuses an `INSERT` and `readonly = 0` (164) and stops at the limit. vitest: the two states from the
hash, the parameters listed and carried by Run (`param_<name>`), Reset as a navigation, a draft kept over a refresh,
the edited note, an error with the editor kept, no selection while edited; with Explore off the extension registers
only the greyed "Explore (from scratch)". Playwright (`e2e/explore-view.spec.ts`, skipped while Explore is off): open the view, the
editor open with `{__from}` listed, delete the `GROUP BY`, Run (more rows, the note, `exploreSql` and `param___from`
in the URL), reload (still edited), Reset.

### 4.8 The batch of 2026-10-31: Explore (decided 2026-10-31; D8, D9 ✅ built 2026-10-31 in step 8g, D11 in step 8h, D10 in step 8i, D13 in step 8k, D12 in workbench step 9d)

The Explore parts of the workbench batch (workbench §3.14, steps 8g–8k); each step rewrites what it changes above.

- **D8 Explore off is off (step 8g, ✅ 2026-10-31):** with `explore.enabled: false` the whole Explore extension is
  off: no "Open in Explore view" in the chart menu, no Explore tabs. The server endpoints check the flag **in their
  handlers** (`HandleSql`, the edited-rows handler, the free SQL endpoint of D10) and answer 404 before any query.
  The only trace in the UI: the global "…" menu (D10) shows "Explore" greyed, hovered "Explore is not enabled
  (explore.enabled)" (the entry reads "Explore (from scratch)" since workbench commit c56c7cc). Built as §4.4, §4.5 and §4.7 say: the client reads `workbench.json`'s `explore`; the greyed
  entry is a menu entry that is not `enabled` (workbench §3.11), its command `exploreView.open`, which only Explore on
  registers (step 8i) *(proposed)*; the free SQL endpoint is `/rows?connection=` of D10.
- **D9 Placeholders, not literals (step 8g, ✅ 2026-10-31):** the key `xsql` is renamed `exploreSql` everywhere (Go,
  TS, the tab's hash, the docs). The editor shows the chart's SQL with its ClickHouse parameter placeholders
  (`{__from:DateTime64}` …), not their values written in; the values are listed beside the editor, and Run sends them
  along again as parameters. `lib/clickhouse/inline_parameters.go` (its own escaping) goes. This reverses "not the
  `{name:Type}` placeholder" of §4.7 for parameters; `{{DASHICA_FILTERS}}` stays filled in *(proposed)*. Built as §4.5
  and §4.7 say; the values travel as `param_<name>` keys, ClickHouse's HTTP names, in the tab's hash and the rows
  request *(proposed)*.
- **D10 Explore without a chart (step 8i, ✅ 2026-10-31):** the global "…" menu (at the left rail's start since workbench step 9i). Its
  "Explore" opens a blank Explore tab: a ClickHouse connection picker (the connections of `dashica_config`) and an
  empty editor, run on a new endpoint per connection behind `explore.enabled` (read-only, the same row limit and casts
  as the edited rows); "Start from chart…" fills the editor from one of the shown page's charts. Since workbench
  commit c56c7cc the two entries read "Explore (from scratch)" and "Explore (from chart…)". Built as:
  - **Server:** `GET /rows?connection=<name>&exploreSql=<text>&param_<name>=…` (`httpserver.ConnectionRowsHandler`)
    answers the text on that connection as an edited query is answered (`readonly=2`, the LIMIT around it,
    `httpserver.ExploreRowLimit` = 100000, `PlainArrowCast`, the `param_` values bound), its check of the flag first
    (404 before any query), then 404 for a connection not in dashica_config, 400 for an empty text. Free SQL keeps the
    trust model of the edited query (all authenticated users trusted; ClickHouse refuses writes): nothing of it is a
    pill, and pills stay signed.
  - **Tab:** the page kind `explore` with an empty id, `#explore=&connection=<name>` on the URL of the tab it was
    opened from (its time range is not used); Run puts `exploreSql` and `param_<name>` into the hash, as for a chart,
    so a reload or a link runs it again; the picker sets `connection` in the hash and runs the query again there. The
    tab says "Explore"; before a Run the body says "Write a query; Run shows its rows."; its rows open as a datagrid of
    all their columns, one viewer config kept for all blank tabs (`view:blank`); no "Reset to the chart's query" and
    no click to filter (edited rows offer none) *(proposed)*.
  - **Menu:** "Explore (from scratch)" (`exploreView.open`) picks the connection of the shown page's first chart, else the first of
    `workbench.json`'s `connections` *(proposed)*. "Explore (from chart…)" (`exploreView.startFromChart`, greyed while the
    shown page has no chart with rows) asks in the quick pick for one of the page's charts (title, its connection
    beside it), fetches its `/sql` with the active tab's query state and opens a blank tab on its connection with that
    SQL and those parameters in the hash, so it runs at once *(proposed)*; a chart that does not run (204) gives an
    empty editor.
- **D11 Schema view (step 8h, ✅ 2026-10-31; views since workbench step 9x, D32):** a left side panel "Schema": a tree
  connection › database › table as two views, "On this page" (exactly the tables the shown page's charts read) and
  "All connections" (every connection), each closable, its state kept; "Show comments" in the panel's "…". A table opens structured as DataGrip shows it: columns with type,
  default and comment; engine, ORDER BY, PARTITION BY, primary key, TTL, skip indices. One cached query set per
  connection on `system.tables`, `system.columns` and `system.data_skipping_indices`, refreshable from the view. The
  same data feeds the editor's autocomplete (D12). Built as: `GET /schema.json?connection=<name>` answers
  `clickhouse.Schema` (`{database, databases: [{name, tables: [{name, engine, sortingKey, partitionKey, primaryKey, ttl, comment,
  columns, skipIndices}]}]}`, generated into the TS types), kept on the connection's client until `&refresh=1`; the
  TTL is cut from `engine_full` (system.tables has no TTL column); the connections come from `workbench.json`'s
  `connections`, a page's tables from its nodes' `table` and `connection` (a `table` without database in the
  connection's own, the answer's `database`). The view and `/schema.json` are part of Explore: without
  `explore.enabled` there is no panel and the handler answers 404 *(proposed)*. Every database the user sees is
  listed, `system` included; a table opens in place in the tree; "Refresh" is in the panel's "…" *(proposed)*.
- **D12 SQL editor (step 8j):** CodeMirror 6, `@codemirror/lang-sql` with a ClickHouse dialect (`SQLDialect.define`),
  its `schema` option fed by the Schema data; loaded only when Explore opens (with the Perspective bundle). Replaces
  the `<textarea>` of §4.7. ✅ 2026-10-31 in workbench step 9d (workbench §3.15 D12): `frontend/extensions/sql-library/`,
  its own bundle `public/dist/sql-editor.js` imported when the view opens (not with the Perspective bundle, so the
  filter bar's SQL condition can load it alone *(proposed)*); the schema option from `/schema.json` of the chart's
  connection (its table the default table) or the blank Explore's picked one; Cmd / Ctrl+Enter runs, as before.
- **D13 Viewer (step 8k, ✅ 2026-10-31):** Perspective's settings panel opens when the view opens; "Reset" asks for
  confirmation first. Built: each new viewer gets `toggleConfig(true)` after its config is restored (Perspective's
  documented call); the kept config leaves out `settings`, so the panel opens every time, whatever it was when the
  viewer closed *(proposed)*. "Reset" asks in a quick pick below the button, "Reset" or "Cancel"
  (`confirmReset`, `ui.showQuickPick` as D3); Escape or a press elsewhere is Cancel *(proposed)*. Reset itself leaves
  the panel as it is *(proposed)*.

## 5. Alternatives considered

| Alternative | For | Against |
|---|---|---|
| Derived raw rows per chart (the first draft: `sql.Rows`, dimensions re-selected under their aliases, `* EXCEPT`, AutoBucket to its raw column, `sql.Rows(...)` declared for SQL files) | the view regroups by the chart's computed dimensions | alias shadowing, declared rows per SQL file, `timeAxes()` in the generator: much machinery for what one explicit "Remove grouping" gives; the maintainer prefers the original data (2026-10-31) |
| Grouping pushed down to ClickHouse (a virtual-server handler in the browser, `POST <dataUrl>/rows/view`) | exact over the full window | a SQL translator in Go, one query per viewer change; not planned (2026-10-31) |
| Perspective's ClickHouse handler in the browser, or in Python / Node beside Dashica | ready-made | credentials in the browser, or a second runtime whose SQL bypasses Dashica's filters |
| Explore view in a bottom panel | stays beside the dashboard | rows want space; the overlay keeps the time picker and filter bar |
| Perspective as the table widget, or for all charts | one engine | §4.6 |
| Derive a SQL file's ungrouped rows by parsing its SQL | no author work | SQL parsing (CTEs, UNIONs, subqueries) is what the workbench avoids |
| Do nothing | no 5 MB, no new code | "status codes by host by path" keeps needing a new Go widget |
| Keep "Remove grouping" beside the editor | one click for the raw rows | a second path for what deleting the `GROUP BY` does, builder charts only; `sql.Ungrouped` and its gate to keep (decided against, 2026-10-31) |
| The editor shows the query with `{{DASHICA_FILTERS}}` / placeholders, Go fills them on Run | the page's time range and chips keep applying to the edited text | not the SQL that runs; a SQL file's text shown with a placeholder is not what one adjusts "fully" (maintainer, 2026-10-31: "NOT DASHICA_FILTERS PLACEHOLDER"); since step 8g (D9) the parameters are placeholders again, their values beside the editor and bound on Run; `{{DASHICA_FILTERS}}` stays filled in *(proposed)* |
| Edited SQL in the query string (`?exploreSql=`), or the POST body of a run | visible to the server | the query host and the shell's request carry it for nothing, and URL length counts there; a POST loses reload and links. The hash keeps it client-side (§4.7, proposed) |
| Materialize with ClickHouse (`EXPLAIN SYNTAX` with the parameters bound) | ClickHouse's own substitution | one more round trip, and the text comes back reformatted and rewritten, not the chart's SQL |
| `max_result_rows=100000` with `result_overflow_mode=break` for the limit (built first, replaced 2026-10-31) | no change of the text | the text can set it back (`SETTINGS max_result_rows = 0`, allowed under `readonly=2`); it is also checked for subqueries, which `break` cuts without an error; whole blocks, so more rows than the limit. The `LIMIT` wrapper's own costs are already paid: `PlainArrowCast` wraps the text in a subquery too, so a `FORMAT` clause fails either way and the outer `SELECT` keeps the inner `ORDER BY` in practice (§8.4) |

## 6. Risks and steps

### Risks

| Risk | Mitigation |
|---|---|
| Edited SQL reads any table the chart's ClickHouse user can read, raw data included (IPs, user ids) | only with `explore.enabled`, default off; read-only (GET, `readonly=2`); the chart's connection only; all authenticated users are trusted today, permissions per viewer later at the same place (§4.7) |
| Edited SQL writes or changes settings back (`INSERT`, `SETTINGS readonly = 0`) | ClickHouse refuses it read-only (code 164); **to check** on 26.10 with an integration test (§4.7) |
| A value of the chart's SQL becomes SQL (`'`, `\`) | since step 8g no value is written into the text: the parameters are sent back as `param_<name>` and ClickHouse binds them (§4.7); the pills' conditions are the server's own, signed (workbench §3.8) |
| The chart's SQL with its parameters, run as an edited query, differs from what the chart ran | the same text and values, bound by ClickHouse as for the chart; integration test: the same rows as the chart (`rows_e2e_test.go`, to check in CI) |
| A selection from an edited query's rows filters on columns the charts do not have, and the page goes empty | the view offers no selection while edited (§4.7) |
| The truncated extract misleads ("top hosts" over the first 100k rows only) | the toolbar says "the first n rows (limit)" when the limit is reached |
| Wide rows (`SELECT *` on a log table with JSON attributes) exhaust memory or bandwidth | `LIMIT 100000` around the text; ClickHouse's `max_result_bytes` with `break` did not stop a `LIMIT` query in `clickhouse local` 25.9 (spike), so it is not sent |
| A long or heavy edited query | ClickHouse's own limits for the user (`max_execution_time` in its profile); the query stops when the view refreshes or closes (`cancel_http_readonly_queries_on_client_close`) |
| ClickHouse Arrow types Perspective may not read (`DateTime` as `UInt32` seconds, `UInt64`, `UUID`) | `clickhouse.PlainArrowCast` in transport; `UInt64` above 2^53 loses exactness as `Float64` |
| Breaking changes between Perspective majors | exact versions pinned; one extension imports it; surface: `client.table`, `table.replace`, `viewer.load/restore/save/reset`, two events |
| ~5 MB first load, wasm in a Web Worker, CSP | lazy bundle; a future CSP must allow `worker-src blob:` and `wasm-unsafe-eval` |
| No browser in the sandbox | the maintainer runs it; a Playwright spec opens the view on a page of the running instance |

### Steps

1. ✅ **Spike** (2026-10-30): the first draft built (derived rows, declared rows), without a browser or ClickHouse.
2. ✅ **Simplified** (2026-10-31, after the maintainer's notes): the chart's result, "Remove grouping" for builder
   charts behind `explore.enabled`; `sql.Rows`, `sql.ExploreLimit`, `?count=1`, the byte cap and `timeAxes()` removed
   (§8).
3. **The maintainer's first run** in a browser (§8.1); the measurements of §8.3.
4. ✅ **Editable SQL** (decided 2026-10-31, §4.7; its `/sql` literals, `xsql` and gate replaced by step 8g), one commit
   apart from the workbench's filter chips (workbench step 7b): `/sql` with `InlineParameters`, `?xsql` read-only with
   the row limit, the editor in the view; "Remove grouping" and `sql.Ungrouped` removed. ✅ 2026-10-31 (vitest and Go
   tests without ClickHouse green; the ClickHouse tests in `lib/httpserver/rows_e2e_test.go` and the Playwright tests
   written, not run: the sandbox reaches no ClickHouse and no browser), deviations:
   - **Writes fail before ClickHouse runs them:** the transport describes every Arrow query as a subquery
     (`DESCRIBE (<text>)`, `ensureArrowCompatible`), where an `INSERT` or `CREATE` is a syntax error (code 62), not
     `READONLY` (164); `readonly=2` is still set and refuses `SETTINGS readonly = 0` (to check: 164 on 26.10). A user
     whose profile is `readonly = 1` can change no setting, so `/query` fails for it already; nothing new.
   - **The gate** is `editable(explore, needs, handler)` in `widget_common.go`, `needs` saying which request requires
     Explore (`/sql`: each, `/rows`: one with `xsql`); `HandleEditedRows(queryObj, text, limit, w, r)` takes the limit;
     the shared client lookup is `QueryHandler.client`. An empty `xsql` (spaces, a `;`) is a 400; the 404 says
     "Explore is not enabled (explore.enabled)".
   - **`/sql` of a skipped chart** answers 204, the editor gets no text.
   - **The editor fetches `/sql` only while it is open** (and when it opens), not on every refresh while closed. A
     Run of the same edited text runs it again (the page host fires `onDidChangeHash` for the same hash too).
   - `editedSql` / `withEditedSql` (`view.ts`) read and write `xsql` of the tab's hash; the view gets `hash`,
     `onDidChangeHash` and `navigate` (`page.navigate('#explore=3&xsql=…')`) from the renderer.
   - `InlineParameters` writes a NUL byte of a value as `\0`; `#` comments are not skipped (only `--` and `/* */`),
     nested `/* */` neither.
5. (With the Explore rebuild) the widget builder joins the view.
6. **The batch of 2026-10-31** (§4.8; workbench steps): ✅ 8g D8 + D9 (Explore off, `exploreSql`, placeholders;
   2026-10-31: vitest, typecheck, top comments, `go vet` and the Go tests without ClickHouse green; the ClickHouse
   tests and Playwright written, not run, deviations in §4.8); ✅ 8h D11 (Schema view, 2026-10-31, the same checks,
   deviations in §4.8); ✅ 8i D10 (global "…" menu, blank Explore, `/rows?connection=`, 2026-10-31, the same checks,
   deviations in §4.8); ✅ 8k D13 (settings panel open, Reset asks; 2026-10-31, vitest, typecheck, top comments
   green, Playwright written, not run, deviations in §4.8); ✅ 8j D12 (CodeMirror) as workbench step 9d (2026-10-31, vitest, typecheck, top comments green, the bundle not built, Playwright written, not run).

## 7. Open questions

1. **Is the Explore view wanted enough to carry 5 MB lazily loaded?** Recommendation: yes, after the first run; paid
   on first use only.
2. ✅ **Reversed and decided 2026-10-31** (§4.7): the view edits the chart's whole SQL as text, materialized (no
   placeholder; since step 8g its parameter placeholders stay, their values beside it, §4.8 D9), for builder and
   SQL-file charts alike, behind `explore.enabled`, read-only; "Remove grouping" goes.
   The question as it stood: **Changing the query in the view** (maintainer's note: "a way in Explore to change the SQL query … and drop the
   groupings", more explicit than derived rows). Not built. What exists: the free SQL filter `sql=` (any WHERE, on every
   chart of the page) and `lib/explore`'s preview (deprecated; deleted since workbench step 9aw), which already ran a widget the browser
   sends, including a `raw` query, through `widget.DataHandler`, so the path from "SQL text in the view" to Arrow exists.
   Open: whether the view edits (a) the chart's whole SQL as text, for builder and SQL-file charts alike, sent as a
   `raw` query, or (b) a few structured parts (columns, GROUP BY, LIMIT) of a builder query; and who may send SQL: the
   free filter already runs any WHERE with the dashboard's ClickHouse user (all authenticated users are trusted
   today), a whole query reads any table that user can read, so the same `explore.enabled` gate, later permissions,
   apply. Recommendation: (a) behind the gate, with the chart's built SQL (`/debug`) as the starting text, once the
   first run shows the view is used.
3. **Row limit:** 100,000 rows of an edited query (was: the newest 100,000 without grouping). Recommendation: keep; measure memory and bytes on the first
   run; make it a setting only if a dashboard needs another.
4. **Explore enabled per instance or per viewer?** Today one flag per instance (`explore.enabled`); permissions per
   viewer replace it.
5. **Viewer config in the URL** for share links (`?view=…`), or `localStorage` only? Recommendation: `localStorage`
   first.
6. **`UInt64` ids as `Float64`:** exact only up to 2^53. Recommendation: decide on real rows.
7. **Charts beneath the view keep re-querying on each refresh.** Pause them while the view is open? Recommendation:
   only if the load is noticeable.
8. **Explore page or overlay?** The view lies over the dashboard (`#explore=<id>`). Open: move it onto the Explore
   page of workbench §6 when that exists, or keep the overlay (it keeps the dashboard's time picker, filter bar and
   Back without a route).

## 8. Spike result (2026-10-30, simplified 2026-10-31)

Branch `spike/perspective` (from `feature/workbench`). **Nobody has run it yet:** the sandbox had no browser and no
connection to ClickHouse, and the frontend build was not run. "Works" below means: implemented, unit-tested,
typechecked.

### 8.1 What works and how to try it

Updated 2026-10-31 to the SQL editor of §4.7, which replaced "Remove grouping" and `?grouping=none`.

- Every chart serves `<dataUrl>/rows` (`rowsUrl` in `page.json`): its query as at `/query` in plain Arrow types; with
  `explore.enabled`, also `<dataUrl>/sql` (the chart's query and its parameters, since step 8g) and
  `/rows?exploreSql=<text>&param_…` (an edited query, read-only, at most 100,000 rows) (§4.7).
- With `explore.enabled` (since step 8g; else only "Explore (from scratch)" greyed in the global menu), a chart's menu (⋮) has "Open
  in Explore view": the chart's result in `<perspective-viewer>` in a new tab,
  rebuilt as the chart (§4.2), with a toolbar "Explore: <title>", the row count, the filters the chart ignores,
  "SQL" (Explore enabled), "Reset" and "Close".
- "SQL" shows the chart's query as it runs, time range, filters and values written in. Until edited it follows the
  page's time range and chips; edited, "Run" shows the rows of exactly that text, the view says the page's time
  range and filters no longer apply, and "Reset to the chart's query" returns to the chart's result. Removing a
  grouping is deleting its `GROUP BY`.
- The time picker, refresh and filter bar above it re-fetch the rows; the viewer keeps its config.
- A click on a group row of the chart's result opens the quick pick "Filter" ("Filter" / "Exclude" its value, since
  workbench step 8c); either adds a filter chip at once and the rows re-fetch. The rows of an edited query offer
  nothing (§4.7).
- The viewer's config is kept per chart and mode once the user has changed it; "Reset", once confirmed, forgets it.

Steps for the maintainer (none of them were run in the spike):

1. In `dashica-src`: commit the working tree's `package-lock.json` (already installed: it has the five
   `@perspective-dev/*@5.6.1` packages of `package.json`, and no Tailwind or daisyUI). The committed lock has none of
   them, so `npm ci` (outer repo's `server:build-npm`, CI) refuses the branch until then.
2. Enable Explore for the SQL editor: `explore: { enabled: true }` in the outer repo's
   `dashica_config.sandstorm.yaml` (or `EXPLORE__ENABLED=true`).
3. Build: `node frontendBuild.mjs` in `dashica-src`, or `mise run server:build` in the outer repo; it also writes
   `public/dist/perspective.js`, `perspective.css` and three `.wasm` files.
4. Outer repo: `mise r watch`, then open `http://127.0.0.1:8081/templates/oekokiste-caddy-ingress?time=168h`.
5. On "Absolute HTTP 500 Errors per Instance" click ⋮, then "Open in Explore view". The URL gets `#explore=<id>`.
6. Change the time range or add a filter: the rows re-fetch, the grouping stays. Click a group row → "Filter by".
7. Press "SQL": the chart's query with the window and chips written in. Delete its `GROUP BY` (and the aggregates),
   press "Run": the Caddy rows of the window. "Reset to the chart's query": the chart's result again.
8. Regroup in the viewer, close, reopen: the grouping is back, the settings panel open. "Reset", then "Reset" in its
   quick pick, returns to the chart's config ("Cancel" keeps it).
9. E2E: `npm run e2e -- explore-view.spec.ts` against your running instance (defaults to the page and chart above;
   `DASHICA_E2E_EXPLORE_PAGE` / `DASHICA_E2E_EXPLORE_CHART` pick others); the SQL editor test is skipped without
   `explore.enabled` (step 2).
10. ClickHouse tests: `mise exec go -- go test ./lib/httpserver/` with the test ClickHouse on `127.0.0.1:28123`
    (`TestHandleRows_*`, `TestHandleSql_*`, `TestHandleEditedRows_*`, written but never run).

### 8.2 Deviations

Note (2026-10-31): ✅ adapted to the tabs of workbench step 7a: the overlay below (`showOverContent`, the dashboard's
hash, the query host keeping the hash) is replaced by a tab of the page kind `explore` (`page.registerPageRenderer`,
`page.navigate(exploreUrl(tab URL, id), { newTab: true })`, "Close" = `context.close()`); the view renders with the
tab's `context.query`. So the "Cost" in the first row is gone: the dashboard's tab is in the background, its charts
query nothing. Not run in a browser; `e2e/explore-view.spec.ts` updated.

| Plan | What was done | Why |
|---|---|---|
| Explore page, `page.kind === 'explore'` (workbench §6) | the dashboard's hash `#explore=<id>`, laid over the content area by `UiApi.showOverContent`; the dashboard beneath stays rendered and `inert`; the query host keeps the hash when it writes the URL | no Explore page exists; a client-only page needs a Go route and shell. Cost: visible charts beneath still re-query on refresh |
| esbuild `splitting` + ESM lazy chunk | second esbuild entry `public/dist/perspective.js` (ESM, minified), wasm under stable names, `import()`ed by URL on first use | splitting needs an ESM `index.js` and a module script in `shell.go` |
| "n newest of N rows" with a `?count=1` request | "the newest n rows (limit)" when the answer has as many rows as `X-Dashica-Rows-Limit` | one request less and no count handler; the total is not shown |
| `max_result_bytes` cap | not sent | measured ineffective under `LIMIT` in `clickhouse local` 25.9 |
| Types cast in the rows query | cast in transport: `QueryOptions.Cast` with `clickhouse.PlainArrowCast`, which generalises the existing describe-and-wrap of `ensureArrowCompatible` | the SQL stays readable; also the chart's result needs it (`count()` is `UInt64`) |
| Five npm packages `@perspective-dev/*@5.6.1` | as planned: client, server, viewer, viewer-datagrid, viewer-charts | `@finos/perspective` is the deprecated old name |
| "Explore enabled" | a config flag `explore.enabled`, read by the chart's handler from the config injected as `rendering.Dependencies.Config` (since step 9v of the workbench concept; before, a copied flag `ExploreEnabled`) | the deprecated `exploreBaseURL` is shared state about the old Explore page; a value where the handler is built is the least machinery |
| The toggle's visibility from `page.json` or `workbench.json` | from the answer's header `X-Dashica-Grouping: removable` | one place decides (the handler); no new generated field |
| Toggle state | per open view, not in the URL or storage | the least state; reopening starts on the chart's result |

### 8.3 Unverified, and what to measure

Not run at all: the frontend build, the page in a browser, the Playwright spec, the ClickHouse tests
(`TestHandleRows_*`, blocked: `dial tcp 127.0.0.1:28123: connect: operation not permitted`). Perspective is mocked in
every unit test.

| Measurement | State |
|---|---|
| Arrow types Perspective reads: `Date32`, `Timestamp(ms)` from `DateTime64(3)`, `Float64` from `UInt64`, `Utf8` from `LowCardinality` | ClickHouse side checked in `clickhouse local` 25.9; Perspective side **to measure** |
| Bytes and load time for 100k rows without grouping (Caddy logs, one request-log table) | **to measure** (`clickhouse local`: 100k rows of 1 kB ≈ 101 MB) |
| Memory per tab for 100k rows (wasm32 and wasm64) | **to measure** |
| `table.replace` with the other mode's columns | the view makes a new table on a toggle; **to measure** whether `replace` throws on other columns at refresh (the view falls back to a new table) |

Also unverified in a browser: the wasm and blob workers load; which axis `Heatmap` puts `group_by` on; when
`perspective-click` fires and what `config.filter` holds for chart plugins; the theme in light and dark; Back / Close /
hash handling.

### 8.4 Known limits

- `npm ci` fails until the working tree's `package-lock.json` is committed (§8.1, step 1).
- `UInt64` above 2^53 loses exactness as `Float64` (question 6).
- The cast wrapper's outer `SELECT` keeps the inner order only in practice; Perspective sorts itself.
- Existing, not fixed: `/query` still breaks on `UUID` and `BFloat16` columns (its default cast covers JSON, Object,
  Dynamic, Variant only).
