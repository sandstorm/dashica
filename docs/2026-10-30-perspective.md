# Perspective for the Explore view (technical concept)

Status: **draft (2026-10-30); simplified (2026-10-31, after the maintainer's notes); built as a spike on branch
`spike/perspective`, not yet run in a browser: see §8. Decided 2026-10-31: the view shows the chart's materialized SQL
in an editor, and an edited query runs as it is written; this replaces "Remove grouping" (§4.7). Decided 2026-10-31
as well, planned (§4.8, workbench §3.14 D8–D13): placeholders instead of literals, `exploreSql`, Explore off means
off, a global "Explore" without a chart, a Schema view, CodeMirror.**

Builds on the workbench concept (`docs/2026-10-28-workbench.md`: §3.8 selections, §6 "Explore rebuilt", "drill to
detail", "Perspective instead of the Tabulator table").

## 1. Context and goal

[Perspective](https://perspective-dev.github.io/) is a WebAssembly data grid, pivot engine and chart viewer. It reads
Apache Arrow, which every Dashica data handler already returns.

**Goal: an Explore view for every chart.** "Open in Explore view" on a chart or table opens **the chart's own query,
as the chart runs it** (its result: what the chart drew) in Perspective, rebuilt as the chart (a time bar with
`fill: status` opens as a bar chart over time, split by `status`). From there the user regroups, filters and switches to
a grid, without writing Go or SQL. Beyond that, **the view shows the chart's SQL as it runs** (the time range, the
filters and the form values written in as literals) in an editor; the user changes it freely (drops the `GROUP BY`,
selects other columns) and runs it, read-only and at most 100,000 rows, when Explore is enabled (§4.7, decided
2026-10-31). Until 2026-10-31 a toggle "Remove grouping" asked Go for the chart's query without its grouping; the
editor replaces it.

This concept answers:

1. What the Explore view shows: the chart's query, and the SQL the user edits from it (§4.1, §4.7).
2. Who may run edited SQL: only when Explore is enabled, read-only; permissions later (§4.7).
3. How a chart's props (`x`, `y`, `fill`, …) become Perspective's initial viewer config (§4.2).
4. Where Perspective runs: in the browser (§4.3).
5. What happens to the table widget (Tabulator) and the charts (Observable Plot): **both stay** (§4.6).

Fixed: ClickHouse credentials never reach the browser. **Reversed 2026-10-31:** the client sends SQL for the Explore
view, the edited query (`xsql`, `exploreSql` from step 8g, §4.7, §4.8), beside the page's SQL chips (`sql=`); Go runs it with the chart's ClickHouse
connection, read-only. Guiding principle (maintainer): the least machinery that still behaves nicely.

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
- `lib/explore`'s preview (`preview/query`, registered by `docs/dev-server` only) runs a widget the browser sends as
  JSON through the same `widget.DataHandler` as a mounted chart, including a query of kind `raw` (`sql.FromString`):
  SQL from the browser.
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

**Recommendation (2026-10-31, after the maintainer's notes): one Explore view on Perspective in the browser, opened
from any chart, on the chart's own query as the chart runs it. With Explore enabled the view shows that query's
materialized SQL in an editor; an edited query runs as written, read-only, at most 100,000 rows (§4.7). Tabulator and
Plot stay.**

```
 dashboard chart               Go (the chart's handler)                Explore view (lazy bundle)
 ┌──────────────┐ "Open in    ┌──────────────────────────────────┐    ┌───────────────────────────────┐
 │ timeBar      │  Explore    │ GET <dataUrl>/rows               │    │ <perspective-viewer>          │
 │ x=AutoBucket │  view" ────▶│  the chart's query as at /query  │───▶│  initial config from props    │
 │ y=Count      │  + Query-   │ GET <dataUrl>/sql                │Arrow│  group / split / filter local │
 │ fill=status  │  State      │  that query, materialized (text) │    │  SQL editor: Run, Reset       │
 └──────────────┘             │ GET <dataUrl>/rows?xsql=<text>   │    └───────────────────────────────┘
                              │  the edited text, read-only,     │
                              │  at most 100000 rows (Explore on) │
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
  is built (`rendering.Dependencies.ExploreEnabled`, set from the config in `dashica.New`); with it off, or for a SQL
  file, `grouping=none` answers 404 and the answer has no `X-Dashica-Grouping`, so the view shows no toggle.
  Permissions per viewer come later and replace the flag by a per-request decision at the same place.
- **The gate and the free SQL filter:** the gate decides which rows `/rows` serves. The page's free SQL filter (`sql=`)
  goes with every request, `grouping=none` included, and is SQL from the client: without grouping it sees the raw
  columns, and on any chart, Explore off, it can already ask about raw columns through `/query` (subqueries included).
  It keeps its existing trust model (all authenticated users are trusted); permissions later cover both.
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
  view', group: 'data' })` for charts (`rowsUrl` in the widget's node).
- **Place** (a tab since 2026-10-31, workbench §3.4.1, step 7a): a new tab of the page kind `explore`, named in its
  hash; its URL is the source tab's with `#explore=<id>` (the id of the chart's `dataUrl`), so it starts with a copy of
  that tab's query state and a link or a reload opens it again. The top bar (time picker, refresh) and the filter
  bar show the Explore tab's state and refresh it (`table.replace(bytes)`, the viewer keeps its config); the
  dashboard's tab keeps its own. The tab is titled "Explore: <chart title>"; Back shows the dashboard's tab, "Close"
  closes the Explore tab. A hash naming a chart the page lacks (or one without rows) shows "<page> has no chart <id>
  to explore" in the tab. Before: the dashboard's hash, laid over the content by `UiApi.showOverContent` (gone).
- **Toolbar:** title, "n rows of the chart's result" / "the first n rows (limit)" (an edited query), the filters the
  chart ignores, "SQL" (opens the SQL editor, §4.7; shown only when the answer says `X-Dashica-Sql: editable`), "Reset",
  "Close". "Remove grouping" goes (§4.7).
- **Filters from the view:** `perspective-click` on a group row gives `[[column, '==', value], …]`; the deepest such
  value on a column that is no date or time is offered in the quick pick "Filter" at the click (since workbench step
  8c: `widgets.offerFilters`, "Filter" / "Exclude"), which adds a page filter chip at once (all rows re-fetched); on
  the chart's result only, an edited query's rows offer nothing (§4.7). Perspective's own filters stay local.
- **State:** `viewer.save()` per chart and mode in the extension's `globalState` (localStorage), keys `view:<dataUrl>`
  and `view:<dataUrl>:edited` (was `:ungrouped`), kept once the viewer was used; "Reset" goes back to the config from
  props. The edited SQL itself is in the tab's hash (§4.7).
- **Loading:** a second esbuild entry, `public/dist/perspective.js` + `perspective.css` and its wasm files, `import()`ed
  by URL on first use; dashboards load none of it.
- **Theme:** `explore-view.css` maps `--psp-*` onto `frontend/core/style/tokens.css`, light and dark.

### 4.5 HTTP contract

Since 2026-10-31 (§4.7; proposed where §4.7 says so):

| Request | Answer |
|---|---|
| `GET <dataUrl>/rows?<QueryState>` | the chart's query as at `/query`, Arrow with every column of a plain Arrow type (`clickhouse.PlainArrowCast`: `DateTime*` → `DateTime64(3)`, `Date` → `Date32`, 64-bit+ ints / `Decimal` / `BFloat16` → `Float64`, others → `String`); headers `X-Dashica-Resolved-Time-Range`, `X-Dashica-Bucket-Size`, `X-Dashica-Diagnostics`, `X-Dashica-Sql: editable` when Explore is enabled (replaces `X-Dashica-Grouping: removable`) |
| `GET <dataUrl>/sql?<QueryState>` | `text/plain`: the chart's query as `/query` would send it to ClickHouse for this state, its parameters written in as literals (`clickhouse.InlineParameters`); `X-Dashica-Diagnostics`; 404 when Explore is off |
| `GET <dataUrl>/rows?xsql=<text>` | `<text>` run as it is on the chart's ClickHouse connection, read-only, the same casts, at most 100,000 rows; header `X-Dashica-Rows-Limit: 100000`; no QueryState needed (the view sends it, it is not read); 404 when Explore is off |
| any | 204 for a skipped chart (`X-Dashica-Diagnostics`; not for `xsql`), 400 for an unreadable query state, 500 for a ClickHouse error with ClickHouse's message (`Code: 62. DB::Exception: Syntax error …`) |

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

*§4.8 changes this section (planned): the editor shows placeholders, not literals, and `InlineParameters` goes
(D9); `xsql` is `exploreSql` (D9); the gate sits in the handlers (D8); the textarea becomes CodeMirror (D12).*

Maintainer: "EXPLORE IS SHOWING THE MATERIALIZED SQL AND PEOPLE CAN START ADJUSTING IT FULLY ... SO NOT
DASHICA_FILTERS PLACEHOLDER". The Explore view gets a SQL editor, prefilled with **the chart's query exactly as it
runs**: its window, the page's filters (structured and SQL chips), the form values, its auto buckets, all written
in as literals, without `{{DASHICA_FILTERS}}` and without a `{name:Type}` placeholder. The user edits it freely and
runs it. "Remove grouping" is then just editing the SQL (delete the `GROUP BY`, select `*`), so the toggle goes, and
with it the gap it had: SQL-file charts had no toggle, now every chart, builder or SQL file, has the editor.

**Two states, read from the tab's URL** (proposed: the least state that survives a reload):

| State | Tab's hash | The editor shows | Run / refresh | Page's time range and chips |
|---|---|---|---|---|
| following | `#explore=3` | `GET <dataUrl>/sql?<QueryState>`, fetched again on every refresh (`onDidRequestRefresh`: time, chips, params, the refresh button, auto refresh) | the view shows `/rows?<QueryState>`, the chart's result, as today | apply, re-materialized on every change |
| edited | `#explore=3&xsql=<text>` | `<text>` | `/rows?xsql=<text>`, again on every refresh | do not apply |

- **"Edited" means: the tab's hash has `xsql`.** Run (button, or Cmd / Ctrl+Enter in the editor) puts the editor's
  text into the hash with `page.navigate(<tab URL>#explore=3&xsql=<text>)`: a hash change of the active tab, so the
  page host pushes a history entry and fires `context.onDidChangeHash`, and does not render the tab anew (its
  renderer is named by `explore=3`, which stays). Run on a text equal to the last materialized one removes `xsql`
  (nothing is edited). **"Reset to the chart's query"** (shown while edited) navigates to `#explore=3`. Back undoes a
  Run or a Reset; a reload or a shared link opens the edited query again. The hash, not `?xsql=` in the query string:
  the query host and `page.json` loads look at the search only, so nothing else needs to know the key, and a long SQL
  text never goes to the server with the shell's request (proposed).
- **A draft** (typed, not run) is the editor's text only: while it differs from the last materialized SQL, a refresh
  does not overwrite it, and the editor's note says "not run" (proposed).
- **The view says so while edited:** a note above the viewer, "Edited query: the page's time range and filters do
  not apply", and the button "Reset to the chart's query". The top bar and filter bar stay as they are (the chips
  still apply to the dashboard's tab, and to this one after Reset).
- **The editor:** a plain `<textarea>` (`d-field d-field--full d-field--mono`, as the filter bar's SQL field was): the
  repository has no code editor (no CodeMirror, Monaco or the old Explore's editor in `package.json` or
  `frontend/`). A panel above the viewer, open from the start (since 2026-10-31: behind a button nobody found it); the
  toolbar's "SQL" (`aria-pressed`) closes and opens it, and it opens by itself while edited (proposed). With Explore
  off, the bar says "SQL editing is off (explore.enabled)". Highlighting later, if the plain field is not enough.
- **Selection and viewer config:** an edited query's rows select nothing (no "Filter by": its columns are whatever
  the text selects, and a page chip would not change the edited query anyway). The first viewer config of an edited
  answer is the chart's mapping (§4.2) when every column it names is in the answer, else a plain datagrid of all
  columns; kept per chart under `view:<dataUrl>:edited` (proposed).

**Materialization, in Go** (`GET <dataUrl>/sql`): the `/sql` handler is `queryHandler`'s `serve` as for `/query`
(ParseQueryState, `applyFilters`), then `prepare` as for `/query`, which already gives the SQL text (`p.query`) and
every value bound to it (`p.opts.Parameters`: `__from`, `__to`, `__f<i>`, the form values), and writes
`clickhouse.InlineParameters(p.query, p.opts.Parameters)` as `text/plain`. No round trip through `/debug` or
ClickHouse; the window is resolved once at the server's now, as for `/query`, so the text holds the same timestamps the
chart's request had. The transport's casts (`ensureArrowCompatible`, `PlainArrowCast`) and settings are not part of
the text: Run applies them again (below).

`InlineParameters(query string, params map[string]string) string` (`lib/clickhouse`, a pure function, proposed):

- It scans the text as ClickHouse's lexer does, skipping string literals (`'…'` with `\` escapes and `''`), quoted
  identifiers (`` `…` ``, `"…"`) and comments (`-- …`, `/* … */`), and replaces each `{name:Type}` outside them that
  has a value in `params`. A placeholder without a value stays as it is: Run then fails with ClickHouse's message
  naming it.
- **A value becomes a literal, never SQL:** the value is first decoded as ClickHouse reads a bound parameter (the
  Escaped format: `\n`, `\t`, `\\`, `\'`, … ; **to check**, below), then written as a string literal with `\` and `'`
  escaped (`\\`, `\'`): so no value can end the literal, whatever it holds (`'`, `\`, `}`, new lines). A `String`
  placeholder becomes that literal (`{__f0:String}` → `'web-1'`); a `DateTime` / `DateTime64` one its best-effort
  parse, as ClickHouse parses the bound value with `date_time_input_format=best_effort` (a `CAST` from String would
  follow `cast_string_to_date_time_mode` instead): `{__from:DateTime64}` → `parseDateTime64BestEffort('1761724800')`,
  the type's precision and time zone passed on; a `Nullable(...)` one with the NULL marker `\N` `CAST(NULL AS
  Nullable(...))`; any other type `CAST(<literal> AS <Type>)` (`{__from:UInt32}` → `CAST('1761724800' AS UInt32)`),
  `Type` copied from the placeholder, which is in the chart's SQL from Go or its SQL file, never from the client.
- Most of the window is a literal already (`httpserver.TimeClause`: `timestamp >= 1761724800`), as is an auto bucket
  after `AdjustBuckets` (its rounding function, `toStartOfHour(timestamp)`); placeholders come from the structured
  filters (`{__f0:String}`), the form values (`{path:String}`) and SQL files (`{__from:UInt32}`).

**Running an edited query** (`GET <dataUrl>/rows?xsql=<text>`, `QueryHandler.HandleEditedRows(server, text, w, r)`
in `lib/httpserver/rows.go`, proposed): before `serve`, the `/rows` handler sees `xsql` and, with Explore enabled,
runs the text on the chart's ClickHouse connection (`query.Database()`, so a connection limited to some dashboards by
`query_file_patterns` stays so); the request's QueryState is not read. It sends the text as it is, after trimming
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
- **Gate:** `/sql` and `?xsql` answer 404 unless `explore.enabled`; each `/rows` answer says `X-Dashica-Sql: editable`
  when it is on, so the view shows the editor only then. `/rows` without `xsql` is the chart's result as before and stays
  ungated. The gate is one function in `widget_common.go` (today's `grouping`, renamed `editable(explore, rows)`); the
  flag's comment in `config.ExploreConfig` changes from rows without grouping to edited SQL.

**What goes** (nothing else uses it, checked 2026-10-31): `sql.Ungrouped` and its tests (`lib/dashboard/sql`),
`grouping` / `withoutGrouping` / the `grouping=none` branch in `widget_common.go` and their tests in `rows_test.go`,
`X-Dashica-Grouping`, the `TestHandleRows_*` case without grouping, the view's `#ungrouped` / "Remove grouping" /
`rowsRequest(…, ungrouped)` / `RowsAnswer.groupingRemovable` / mapping kind `ungrouped`, and the "Remove grouping" test
of `e2e/explore-view.spec.ts`. `exploreRowLimit` stays, now the edited query's limit.

**Files** (all B, apart from A's filter chips): `lib/httpserver/rows.go` (`HandleEditedRows`), `lib/httpserver/query_new.go`
(`HandleSql`, from `prepare`), `lib/clickhouse/inline_parameters.go` (+ test), `lib/dashboard/widget/widget_common.go`
(`/sql`, `xsql`, `editable`) and `rows_test.go`, `lib/config/config.go` (comment), `lib/dashboard/sql/ungrouped*.go`
(deleted), `frontend/extensions/explore-view/**`, `e2e/explore-view.spec.ts`. No contract change: the view derives
`<dataUrl>/sql` from the widget's `dataUrl`, as `rowsUrl` sits below it; nothing is regenerated.

**Tests:** Go without ClickHouse: `InlineParameters` (a `String` value with `'`, `\`, `}`, a new line; a typed one as
`CAST`; a placeholder inside a string literal, a quoted identifier and a comment left alone; one without a value left
as it is), `/sql` of a builder chart and a SQL-file chart with a structured and a SQL chip (the text has their
literals and no `{`), the gate (404 for `/sql` and `xsql` with Explore off, `X-Dashica-Sql` only with it on). Against
CI's ClickHouse (blocked in the sandbox): the materialized text of a chart with filters gives the same rows as `/query`;
a bound value with `\n`, `\t`, `\\` and `'` matches its inlined literal (**to check:** whether ClickHouse reads a
bound `String` in the Escaped format, which decides the decoding above); `xsql` refuses an `INSERT` and `readonly = 0`
(164) and stops at the limit. vitest: the two states from the hash, Run and Reset as navigations, a draft kept over a
refresh, the edited note, an error with the editor kept, no selection while edited. Playwright
(`e2e/explore-view.spec.ts`): open the view, "SQL", delete the `GROUP BY`, Run (more rows, the note), reload (still
edited), Reset.

### 4.8 The batch of 2026-10-31: Explore (decided 2026-10-31, planned)

The Explore parts of the workbench batch (workbench §3.14, steps 8g–8k); each step rewrites what it changes above.

- **D8 Explore off is off (step 8g):** with `explore.enabled: false` the whole Explore extension is off: no "Open in
  Explore view" in the chart menu, no Explore tabs. The server endpoints check the flag **in their handlers**
  (`HandleSql`, the edited-rows handler, the free SQL endpoint of D10) and answer 404 before any query. The only trace
  in the UI: the global "…" menu (D10) shows "Explore" greyed, hovered "Explore is not enabled (explore.enabled)".
- **D9 Placeholders, not literals (step 8g):** the key `xsql` is renamed `exploreSql` everywhere (Go, TS, the tab's
  hash, the docs). The editor shows the chart's SQL with its ClickHouse parameter placeholders
  (`{__from:DateTime64}` …), not their values written in; the values are listed beside the editor, and Run sends them
  along again as parameters. `lib/clickhouse/inline_parameters.go` (its own escaping) goes. This reverses "not the
  `{name:Type}` placeholder" of §4.7 for parameters; `{{DASHICA_FILTERS}}` stays filled in *(proposed)*.
- **D10 Explore without a chart (step 8i):** the global "…" menu, left of the Dashica icon. Its "Explore" opens a
  blank Explore tab: a ClickHouse connection picker (the connections of `dashica_config`) and an empty editor, run on
  a new endpoint per connection behind `explore.enabled` (read-only, the same row limit and casts as the edited rows);
  "Start from chart…" fills the editor from one of the shown page's charts.
- **D11 Schema view (step 8h):** a left side panel "Schema": a tree connection › database › table, the shown page's
  connections first, the others below. A table opens structured as DataGrip shows it: columns with type, default and
  comment; engine, ORDER BY, PARTITION BY, primary key, TTL, skip indices. One cached query set per connection on
  `system.tables`, `system.columns` and `system.data_skipping_indices`, refreshable from the view. The same data feeds
  the editor's autocomplete (D12).
- **D12 SQL editor (step 8j):** CodeMirror 6, `@codemirror/lang-sql` with a ClickHouse dialect (`SQLDialect.define`),
  its `schema` option fed by the Schema data; loaded only when Explore opens (with the Perspective bundle). Replaces
  the `<textarea>` of §4.7.
- **D13 Viewer (step 8k):** Perspective's settings panel opens when the view opens; "Reset" asks for confirmation
  first.

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
| The editor shows the query with `{{DASHICA_FILTERS}}` / placeholders, Go fills them on Run | the page's time range and chips keep applying to the edited text | not the SQL that runs; a SQL file's text shown with a placeholder is not what one adjusts "fully" (maintainer, 2026-10-31: "NOT DASHICA_FILTERS PLACEHOLDER") |
| Edited SQL in the query string (`?xsql=`), or the POST body of a run | visible to the server | the query host and the shell's request carry it for nothing, and URL length counts there; a POST loses reload and links. The hash keeps it client-side (§4.7, proposed) |
| Materialize with ClickHouse (`EXPLAIN SYNTAX` with the parameters bound) | ClickHouse's own substitution | one more round trip, and the text comes back reformatted and rewritten, not the chart's SQL |
| `max_result_rows=100000` with `result_overflow_mode=break` for the limit (built first, replaced 2026-10-31) | no change of the text | the text can set it back (`SETTINGS max_result_rows = 0`, allowed under `readonly=2`); it is also checked for subqueries, which `break` cuts without an error; whole blocks, so more rows than the limit. The `LIMIT` wrapper's own costs are already paid: `PlainArrowCast` wraps the text in a subquery too, so a `FORMAT` clause fails either way and the outer `SELECT` keeps the inner `ORDER BY` in practice (§8.4) |

## 6. Risks and steps

### Risks

| Risk | Mitigation |
|---|---|
| Edited SQL reads any table the chart's ClickHouse user can read, raw data included (IPs, user ids) | only with `explore.enabled`, default off; read-only (GET, `readonly=2`); the chart's connection only; all authenticated users are trusted today, permissions per viewer later at the same place (§4.7) |
| Edited SQL writes or changes settings back (`INSERT`, `SETTINGS readonly = 0`) | ClickHouse refuses it read-only (code 164); **to check** on 26.10 with an integration test (§4.7) |
| A value inlined into the materialized SQL ends its literal (`'`, `\`) and becomes SQL | decoded as ClickHouse reads a bound value, then quoted with `\` and `'` escaped; placeholders inside literals and comments untouched; tests with such values (§4.7) |
| The materialized text differs from what the chart ran (a bound value read in the Escaped format, `CAST` of a typed value) | integration test: the materialized text gives the same rows as `/query` (§4.7, to check) |
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
4. ✅ **Editable SQL** (decided 2026-10-31, §4.7), one commit apart from the workbench's filter chips (workbench
   step 7b): `/sql` with `InlineParameters`, `?xsql` read-only with the row limit, the editor in the view; "Remove
   grouping" and `sql.Ungrouped` removed. ✅ 2026-10-31 (vitest and Go tests without ClickHouse green; the ClickHouse
   tests in `lib/httpserver/rows_e2e_test.go` and the Playwright tests written, not run: the sandbox reaches no
   ClickHouse and no browser), deviations:
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
6. **The batch of 2026-10-31** (§4.8; workbench steps): 8g D8 + D9 (Explore off, `exploreSql`, placeholders), 8h
   D11 (Schema view), 8i D10 (global "…" menu, blank Explore), 8j D12 (CodeMirror), 8k D13 (settings panel, Reset
   asks). Planned, not built.

## 7. Open questions

1. **Is the Explore view wanted enough to carry 5 MB lazily loaded?** Recommendation: yes, after the first run; paid
   on first use only.
2. ✅ **Reversed and decided 2026-10-31** (§4.7): the view edits the chart's whole SQL as text, materialized (no
   placeholder), for builder and SQL-file charts alike, behind `explore.enabled`, read-only; "Remove grouping" goes.
   The question as it stood: **Changing the query in the view** (maintainer's note: "a way in Explore to change the SQL query … and drop the
   groupings", more explicit than derived rows). Not built. What exists: the free SQL filter `sql=` (any WHERE, on every
   chart of the page) and `lib/explore`'s preview (deprecated, dev server only), which already runs a widget the browser
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
  `explore.enabled`, also `<dataUrl>/sql` (the chart's query materialized) and `/rows?xsql=<text>` (an edited query,
  read-only, at most 100,000 rows) (§4.7).
- A chart's menu (⋮) has "Open in Explore view": the chart's result in `<perspective-viewer>` in a new tab,
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
- The viewer's config is kept per chart and mode once the user has changed it; "Reset" forgets it.

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
8. Regroup in the viewer, close, reopen: the grouping is back. "Reset" returns to the chart's config.
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
| "Explore enabled" | a config flag `explore.enabled`, passed as `rendering.Dependencies.ExploreEnabled` to the chart's handler | the deprecated `exploreBaseURL` is shared state about the old Explore page; a value where the handler is built is the least machinery |
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
