# Perspective for the Explore view (technical concept)

Status: **draft (2026-10-30); simplified (2026-10-31, after the maintainer's notes); built as a spike on branch
`spike/perspective`, not yet run in a browser: see §8.**

Builds on the workbench concept (`docs/2026-10-28-workbench.md`: §3.8 selections, §6 "Explore rebuilt", "drill to
detail", "Perspective instead of the Tabulator table").

## 1. Context and goal

[Perspective](https://perspective-dev.github.io/) is a WebAssembly data grid, pivot engine and chart viewer. It reads
Apache Arrow, which every Dashica data handler already returns.

**Goal: an Explore view for every chart.** "Open in Explore view" on a chart or table opens **the chart's own query,
as the chart runs it** (its result: what the chart drew) in Perspective, rebuilt as the chart (a time bar with
`fill: status` opens as a bar chart over time, split by `status`). From there the user regroups, filters and switches to
a grid, without writing Go or SQL. One explicit manipulation of the query, done in Go, goes further: **"Remove
grouping"** shows the original rows the chart aggregated (its table, its WHERE, the page's time range and filters),
newest first, at most 100,000 of them, when Explore is enabled.

This concept answers:

1. What the Explore view shows: the chart's query, and that query without its grouping (§4.1).
2. Who may see rows without grouping: only when Explore is enabled; permissions later (§4.1).
3. How a chart's props (`x`, `y`, `fill`, …) become Perspective's initial viewer config (§4.2).
4. Where Perspective runs: in the browser (§4.3).
5. What happens to the table widget (Tabulator) and the charts (Observable Plot): **both stay** (§4.6).

Fixed: ClickHouse credentials never reach the browser; the client sends no SQL for the Explore view beyond the page's
existing free SQL filter (`sql=`, §4.1). Guiding
principle (maintainer): the least machinery that still behaves nicely.

## 2. Current state

### 2.1 Data path

| Step | Where | What |
|---|---|---|
| Query | `lib/httpserver/query_new.go`, `QueryHandler.HandleQuery` | builds SQL from the widget's `sql.SqlQueryable`; unless the query says `ShouldSkipFilters()`, appends `filters.SqlClause(timeRange)` as one more WHERE (`timestamp >= … AND timestamp <= …` plus free SQL); rebakes auto buckets; ClickHouse answers in Arrow (`output_format_arrow_compression_method=none`) |
| Filters | `lib/dashboard/widget/widget_common.go`, `applyFilters` | the page's structured filters (`f`) as the chart interprets them: its own `ApplyFilters`, else `filter.Apply` on its dimensions, which adds a WHERE on the dimension's **definition** (`(replace(customer_project, …)) = {__f0:String}`) or on a column of the base table |
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
from any chart, on the chart's own query as the chart runs it. "Remove grouping" asks Go for the same query without
its grouping, for builder charts and only when Explore is enabled. Tabulator and Plot stay.**

```
 dashboard chart               Go (the chart's handler)                Explore view (lazy bundle)
 ┌──────────────┐ "Open in    ┌──────────────────────────────────┐    ┌───────────────────────────────┐
 │ timeBar      │  Explore    │ GET <dataUrl>/rows               │    │ <perspective-viewer>          │
 │ x=AutoBucket │  view" ────▶│  the chart's query as at /query  │───▶│  initial config from props    │
 │ y=Count      │  + Query-   │ GET <dataUrl>/rows?grouping=none │Arrow│  group / split / filter local │
 │ fill=status  │  State      │  without grouping, newest first, │    │  toolbar: "Remove grouping"   │
 └──────────────┘             │  LIMIT 100000 (Explore enabled)  │    └───────────────────────────────┘
                              └──────────────────────────────────┘
```

### 4.1 What the view shows: the chart's query, and without its grouping

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
- **Without grouping:** a plain datagrid of all columns; the user groups from there.

### 4.3 Where Perspective runs

**Plain browser (maintainer, 2026-10-31).** Perspective's engine runs as wasm in a Web Worker on the Arrow rows Go
serves: no new runtime, Go builds the only SQL, interaction is instant, credentials stay on the server. Against it: the
rows without grouping are a truncated extract (the newest 100,000 of the window), ~5 MB first load, memory per tab.
Pushing grouping down to ClickHouse (a virtual-server handler, a server-side Perspective, Perspective's own ClickHouse
handler) is not planned.

### 4.4 The Explore view

- **Entry:** `ui.registerMenuItem('widget/context', { command: 'exploreView.openWidget', title: 'Open in Explore
  view', group: 'data' })` for charts (`rowsUrl` in the widget's node).
- **Place:** the dashboard's hash `#explore=<id>` (the id of the chart's `dataUrl`), laid over the content region by
  `UiApi.showOverContent(element)`; the title bar (time picker, refresh) and the filter bar stay above it and refresh
  it (`table.replace(bytes)`, the viewer keeps its config). A link opens it, Back closes it, "Close" goes to `#w=<id>`.
- **Toolbar:** title, "n rows of the chart's result" / "the newest n rows (limit)", the filters the chart ignores,
  "Remove grouping" (pressed: rows without grouping; shown only when the answer says `X-Dashica-Grouping: removable`),
  "Reset", "Close".
- **Filters from the view:** `perspective-click` on a group row gives `[[column, '==', value], …]`; the deepest such
  value on a column that is no date or time becomes a `category` selection, and the floating bar (`widget/selection`,
  "Filter by", "Exclude") adds a page filter chip (all rows re-fetched); on the chart's result only, the rows without
  grouping select nothing (§4.1). Perspective's own filters stay local.
- **State:** `viewer.save()` per chart and mode in the extension's `globalState` (localStorage), keys `view:<dataUrl>`
  and `view:<dataUrl>:ungrouped`, kept once the viewer was used; "Reset" goes back to the config from props.
- **Loading:** a second esbuild entry, `public/dist/perspective.js` + `perspective.css` and its wasm files, `import()`ed
  by URL on first use; dashboards load none of it.
- **Theme:** `explore-view.css` maps `--psp-*` onto `frontend/core/style/tokens.css`, light and dark.

### 4.5 HTTP contract

| Request | Answer |
|---|---|
| `GET <dataUrl>/rows?<QueryState>` | the chart's query as at `/query`, Arrow with every column of a plain Arrow type (`clickhouse.PlainArrowCast`: `DateTime*` → `DateTime64(3)`, `Date` → `Date32`, 64-bit+ ints / `Decimal` / `BFloat16` → `Float64`, others → `String`); headers `X-Dashica-Resolved-Time-Range`, `X-Dashica-Bucket-Size`, `X-Dashica-Diagnostics`, `X-Dashica-Grouping: removable` when `grouping=none` is served |
| `GET <dataUrl>/rows?<QueryState>&grouping=none` | the chart's query without grouping (§4.1), same casts and headers, plus `X-Dashica-Rows-Limit: 100000`; 404 when Explore is off or the chart's query is a SQL file |
| either | 204 for a skipped chart (`X-Dashica-Diagnostics`), 400 for an unreadable query state, 500 for a ClickHouse error |

`page.json` names `rowsUrl` (`<dataUrl>/rows`) on every chart.

### 4.6 Table widget and charts stay

- **Table widget (Tabulator) stays.** Its value is Dashica's own features (§2.4), which would be rebuilt against
  Perspective's datagrid plugin API inside a shadow root; a log table is read, not pivoted; ~5 MB per table page.
  **Revisit when** the Explore view is in regular use, users read logs there instead of in the table, *and*
  Perspective's datagrid API has stayed stable across two majors; or when Tabulator stops being maintained.
- **Charts (Plot) stay.** Dashboard charts are declared in Go (marks, colors, thresholds, bucket size, brush), small
  and many per page (5-20); Perspective charts are configured in the viewer, WebGL per chart. **Revisit when**
  dashboards need interactive regrouping in place.

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

## 6. Risks and steps

### Risks

| Risk | Mitigation |
|---|---|
| Rows without grouping leak sensitive raw data (IPs, user ids) to every viewer of a dashboard | served only with `explore.enabled`, default off; permissions per viewer later at the same place (§4.1) |
| The gate is taken for the only path to raw data | it decides what `/rows` selects; the free SQL filter can already ask about raw columns through `/query`, with Explore off; existing trust model, permissions later cover both (§4.1) |
| A selection from the rows without grouping filters a raw value on a computed dimension of the same name, and the page goes empty | the view offers no selection there; only the chart's result selects (§4.1) |
| The truncated extract misleads ("top hosts" over the newest 100k rows only) | the toolbar says "the newest n rows (limit)" when the limit is reached |
| Wide rows (`*` on a log table with JSON attributes) exhaust memory or bandwidth | `LIMIT 100000`; ClickHouse's `max_result_bytes` with `break` did not stop a `LIMIT` query in `clickhouse local` 25.9 (spike), so it is not sent |
| A builder WHERE or the free SQL filter references a SELECT alias of the chart | without grouping the alias is gone: ClickHouse fails with `UNKNOWN_IDENTIFIER`, shown in the view; a free SQL filter on a name that is both alias and column (`customer_project`) compares the raw column |
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
4. **Next: change the chart's SQL in the view** (§7 question 2), also for SQL files.
5. (With the Explore rebuild) the widget builder joins the view.

## 7. Open questions

1. **Is the Explore view wanted enough to carry 5 MB lazily loaded?** Recommendation: yes, after the first run; paid
   on first use only.
2. **Changing the query in the view** (maintainer's note: "a way in Explore to change the SQL query … and drop the
   groupings", more explicit than derived rows). Not built. What exists: the free SQL filter `sql=` (any WHERE, on every
   chart of the page) and `lib/explore`'s preview (deprecated, dev server only), which already runs a widget the browser
   sends, including a `raw` query, through `widget.DataHandler`, so the path from "SQL text in the view" to Arrow exists.
   Open: whether the view edits (a) the chart's whole SQL as text, for builder and SQL-file charts alike, sent as a
   `raw` query, or (b) a few structured parts (columns, GROUP BY, LIMIT) of a builder query; and who may send SQL: the
   free filter already runs any WHERE with the dashboard's ClickHouse user (all authenticated users are trusted
   today), a whole query reads any table that user can read, so the same `explore.enabled` gate, later permissions,
   apply. Recommendation: (a) behind the gate, with the chart's built SQL (`/debug`) as the starting text, once the
   first run shows the view is used.
3. **Row limit:** newest 100,000 rows without grouping. Recommendation: keep; measure memory and bytes on the first
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

- Every chart serves `<dataUrl>/rows` (`rowsUrl` in `page.json`): its query as at `/query` in plain Arrow types; with
  `explore.enabled`, builder charts also serve `?grouping=none` (§4.5).
- A chart's menu (⋮) has "Open in Explore view": the chart's result in `<perspective-viewer>` over the content area,
  rebuilt as the chart (§4.2), with a toolbar "Explore: <title>", the row count, the filters the chart ignores,
  "Remove grouping" (builder charts, Explore enabled), "Reset" and "Close".
- "Remove grouping" shows the original rows (newest first, at most 100,000) as a datagrid; pressed again, the chart's
  result.
- The time picker, refresh and filter bar above it re-fetch the rows; the viewer keeps its config.
- A click on a group row of the chart's result opens the floating bar ("Filter by", "Exclude"); either adds a filter
  chip and the rows re-fetch. The rows without grouping offer no selection (§4.1).
- The viewer's config is kept per chart and mode once the user has changed it; "Reset" forgets it.

Steps for the maintainer (none of them were run in the spike):

1. In `dashica-src`: commit the working tree's `package-lock.json` (already installed: it has the five
   `@perspective-dev/*@5.6.1` packages of `package.json`, and no Tailwind or daisyUI). The committed lock has none of
   them, so `npm ci` (outer repo's `server:build-npm`, CI) refuses the branch until then.
2. Enable Explore for the rows without grouping: `explore: { enabled: true }` in the outer repo's
   `dashica_config.sandstorm.yaml` (or `EXPLORE__ENABLED=true`).
3. Build: `node frontendBuild.mjs` in `dashica-src`, or `mise run server:build` in the outer repo; it also writes
   `public/dist/perspective.js`, `perspective.css` and three `.wasm` files.
4. Outer repo: `mise r watch`, then open `http://127.0.0.1:8081/templates/oekokiste-caddy-ingress?time=168h`.
5. On "Absolute HTTP 500 Errors per Instance" click ⋮, then "Open in Explore view". The URL gets `#explore=<id>`.
6. Change the time range or add a filter: the rows re-fetch, the grouping stays. Click a group row → "Filter by".
7. Press "Remove grouping": the Caddy rows of the window, newest first. Press it again: the chart's result.
8. Regroup in the viewer, close, reopen: the grouping is back. "Reset" returns to the chart's config.
9. E2E: `npm run e2e -- explore-view.spec.ts` against your running instance (defaults to the page and chart above;
   `DASHICA_E2E_EXPLORE_PAGE` / `DASHICA_E2E_EXPLORE_CHART` pick others); the "Remove grouping" test is skipped
   without `explore.enabled` (step 2).
10. ClickHouse tests: `mise exec go -- go test ./lib/httpserver/` with the test ClickHouse on `127.0.0.1:28123`
    (`TestHandleRows_*`, written but never run).

### 8.2 Deviations

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
