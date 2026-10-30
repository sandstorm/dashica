# Perspective for tables, charts or Explore (technical concept)

Status: **draft (2026-10-30)**, for review.

Builds on the workbench concept (`docs/2026-10-28-workbench.md`, §6 "Perspective instead of the Tabulator table") and
the styling concept (`docs/2026-10-30-styling.md`, §6 Tabulator themes).

## 1. Context and goal

[Perspective](https://perspective-dev.github.io/) is a WebAssembly data grid, pivot engine and chart viewer. It reads
Apache Arrow, which every Dashica data handler already returns. The workbench concept lists it as a long-term idea for
the table widget. This concept answers: **where, if anywhere, does Perspective earn its weight in Dashica?** Three
candidates:

- **A** the table widget (today Tabulator),
- **B** an ad-hoc pivot / group / filter view on one query result (the Explore area, or a step towards it),
- **C** everything: tables and the Observable Plot charts.

Guiding principle (maintainer): the least machinery that still behaves nicely.

## 2. Current state

### 2.1 Data path

| Step | Where | What |
|---|---|---|
| Query | `lib/httpserver/query_new.go`, `QueryHandler.HandleQuery` | builds SQL from the widget's `sql.SqlQueryable`, the page's filters and time range; ClickHouse answers in Arrow (`output_format_arrow_compression_method=none`, Arrow JS cannot decompress) |
| Headers | same | `X-Dashica-Resolved-Time-Range`, `X-Dashica-Bucket-Size`, `X-Clickhouse-Summary`, `X-Dashica-Alert-If` |
| Fetch | `frontend/hosts/widgets/widgets-impl.ts`, `fetchQueryResult` | `Arrow.tableFromIPC(response)` into an `apache-arrow` `Table`, headers attached as `QueryResult` fields |
| Context | same, `RenderedWidget.query()` | stores the result as `lastResult` (the Debug panel shows it) |

ClickHouse credentials live only on the server (`dashica_config*.yaml`); the browser never talks to ClickHouse.

### 2.2 Table widget

- Go: `lib/dashboard/widget/table.go`, `widget.NewTable(sql)` with `title`, `height`, `limit` (default 10,000 rows).
  The deployed instance uses it in ~29 dashboard files (`../src/**`): request logs, k8s gateway access, alert lists.
- TS: `frontend/extensions/table/table.ts` (extension, 25 lines) calls `drawTable` in
  `frontend/extensions/chart-library/table.ts` (852 lines, Tabulator 6). Features built on Tabulator:
  - search box over all columns, with highlights via the CSS Custom Highlight API (cells, tooltips, details panel),
  - header filter per column, movable columns, auto-size menus,
  - sticky tooltips that can be pinned, dragged, copied, JSON-pretty-printed,
  - row selection with a record-details panel,
  - timestamp formatting (ClickHouse `DateTime` arrives as seconds),
  - cell context menu "Filter: equals / not equals / contains" and a timestamp window filter; sent as a
    `dashica-add-filter` event with an SQL string to `ctx.state.filters.add`.
- `frontend/extensions/debug/debug.ts` reuses `drawTable` for the result in the Debug bottom panel.

### 2.3 Charts

`frontend/extensions/{time-bar,time-line,heatmap,bar-vertical,bar-horizontal,stats,alerts}` draw with Observable Plot
plus `chart-library/time-brush.ts` (d3-brush; drag sets the time range) and `chart-library/time-bars.ts`. A dashboard
has 5-20 small charts; Go fixes each chart's marks, axes, colors and thresholds (`.X()`, `.Fill()`, alert rules).

### 2.4 Explore

`lib/explore` is deprecated, its UI is gone (`frontend/explore` deleted); the workbench concept rebuilds it later as
extensions on an `ExploreModel` (widget tree, inspector, Data / Go / JSON tabs). Explore's job there is *building a
Go-declared widget*, not ad-hoc analysis of data.

### 2.5 Bundle

`public/dist/index.js` today: 3.9 MB unminified, ~1.1 MB gzipped, one esbuild entry (`frontendBuild.mjs`, no
splitting). The Speedscope viewer is a separate build served per widget (`speedscope_viewer/`), so "heavy viewer
outside the main bundle" has a precedent.

## 3. Perspective today (researched 2026-10-30)

| Topic | Finding |
|---|---|
| License, home | Apache-2.0; OpenJS Foundation project (moved from FINOS), packages renamed `@finos/*` → `@perspective-dev/*` |
| Activity | v5.0.0 on 2026-07-28, v5.6.1 on 2026-10-23: frequent releases, but also frequent breaking changes (v5: `load()` takes a `Client`, workspace removed, `viewer-d3fc` replaced by `viewer-charts`, CSS variables renamed to `--psp-*`) |
| Packages | `@perspective-dev/client` (engine API), `@perspective-dev/server` (the engine as wasm, runs in a Web Worker), `@perspective-dev/viewer` (`<perspective-viewer>` custom element, Rust/wasm), plugins `@perspective-dev/viewer-datagrid` and `@perspective-dev/viewer-charts` (WebGL) |
| Size (npm 5.6.1) | `perspective-server.wasm` 2.6 MB, `perspective-viewer.wasm` 1.65 MB, `perspective-js.wasm` 0.63 MB, JS (client, viewer, datagrid, charts) ~0.55 MB: **~5.4 MB** for the browser. The viewer wasm is shipped compressed and decompressed at load, so gzip will gain little. Roughly 5× today's gzipped bundle |
| Arrow input | `client.table(arrayBuffer)` takes Arrow IPC bytes directly |
| Viewer API | `viewer.load(client)`, `viewer.restore({table, plugin, group_by, split_by, filter, sort, expressions, columns, plugin_config})`, `viewer.save()`; events `perspective-click` (`detail.config.filter`, `detail.row`), `perspective-select`, `perspective-config-update` |
| Theming | CSS custom properties (`--psp-{module}--{component}--{property}`) and theme files; can be mapped onto Dashica's tokens (`tokens.css`) |
| Server side | Python, Node and Rust servers; **virtual servers** (v5): the viewer's group-by / filter / sort are pushed down as SQL to DuckDB, ClickHouse, Polars. The ClickHouse handler (JS: `@clickhouse/client-web` in the browser; Python) creates a `VIEW` in ClickHouse per viewer query, has no `split_by`, no row order, maps only Int64 / UInt64 / Float64 / String / Date / DateTime, runs queries one at a time, and its comments say its function lists are "not verified against a live ClickHouse" |
| Fit | built for one large exploratory view (or a few), on 10k-10M rows. Many small fixed charts are not its shape: chart look is configured by the user in the viewer, not declared; each viewer has its own shadow DOM and settings panel |

## 4. Proposed solution

**Recommendation: B, small. Not A, not C, not the virtual server.** One new extension `pivot` that opens the
result of any chart or table in a bottom panel (or the content area) as a `<perspective-viewer>`, loaded lazily. It is
the first piece of ad-hoc analysis (workbench §6 "drill by / ad hoc") and later becomes Explore's Data tab. Tabulator
stays for the table widget; Plot stays for charts.

### 4.1 Why not A (table widget)

- The table's value is in its Dashica-specific features (§2.2: search highlight across cells/tooltips/details, pinned
  tooltips, JSON details, cell menus to page filters). Perspective's datagrid renders its own virtual DOM in a shadow
  root; each of these would be rebuilt against its plugin API, which changed in v5 (`plugin_static_config`, `save()`
  removed). That is a rewrite of ~850 lines into a less stable API.
- A log table needs to *read* rows, not pivot them. Pivoting a 10,000-row request log is the rare case.
- Cost: ~5 MB on every dashboard with a table, for a widget that works today.
- The styling concept's issue (Tabulator's own themes) is smaller than this; it is solved by overriding a handful of
  Tabulator CSS variables in `table.css`.

### 4.2 Why not C (charts)

- Dashica charts are declared in Go (marks, colors, alert thresholds, bucket size from `X-Dashica-Bucket-Size`, time
  brush). Perspective charts are configured by the viewer; mapping Go's chart vocabulary onto `plugin_config` means a
  second chart model, and loses Plot's marks (rules, tips, annotations).
- 5-20 WebGL viewers per page: v5 works around the browser's WebGL context limit with a "blit" mode; it is extra
  weight for charts that are 200 bars each.

### 4.3 B: the `pivot` extension

```
 chart / table widget                   pivot extension (lazy chunk)
 ┌───────────────────┐  ⋮ menu          ┌──────────────────────────────────────┐
 │ ctx.query() ──────┼─ "Pivot" ───────▶│ Arrow.tableToIPC(lastResult)         │
 │  lastResult       │  widget/context  │ client.table(bytes, {name})          │
 └───────────────────┘                  │ <perspective-viewer> in bottom panel │
                                        │  group / split / filter / sort local │
                                        └───────┬──────────────────────────────┘
                                                │ perspective-click on a group row
                                                ▼
                         widget/selection {kind:'category', fieldId, value}
                         → "Filter by …" (filters ext.) → page re-queries
```

- **Entry:** `ui.registerMenuItem('widget/context', { command: 'pivot.showWidget', title: 'Pivot', group: 'data' })`,
  the same shape as `frontend/extensions/debug/debug.ts`. Shown for widgets with data (`'dataUrl' in widget`).
- **Panel:** `ui.registerBottomPanel('pivot', { label: 'Pivot' })`; one viewer, reused. A "maximize" makes it the
  content area for a big pivot (bottom panel geometry is the workbench's job).
- **Data:** the widget's `lastResult` (what the chart drew, same rows, same query state). `Arrow.tableToIPC(result)`
  turns it back into bytes for `client.table(...)`; at ≤10k rows this costs milliseconds and keeps
  `fetchQueryResult` unchanged. A second button "Load raw rows" re-fetches with a higher limit only if the widget is
  a table; for charts the pre-aggregated result is what there is (a pivot over buckets is still useful: status codes by
  host per hour).
- **Refresh:** on `ctx.state.onDidRequestRefresh` the panel re-fetches through the widget's URL
  (`widget.url('/query')`) and calls `table.replace(bytes)`; the viewer keeps its group-by / filter config.
- **Click-to-filter:** `perspective-click` gives `detail.config.filter` as `[[column, '==', value], …]` for the clicked
  group row. For each column that the widget's props map to a filter field id (workbench §3.8: "inside each chart's
  props, the filter id behind each clickable field"), the panel reports a `category` selection to the `widgets` host;
  the floating `widget/selection` bar offers "Filter by …" as for any chart. Columns without a filter id stay local
  (Perspective's own filter). No SQL leaves the panel.
- **Time:** no brush in the pivot; the page's time range stays the only time control. A clicked row with a time
  bucket column (`time` with `X-Dashica-Bucket-Size`) can report a `time` selection `{from, to = from + bucket}` the
  same way; optional, after the first version.
- **Loading cost:** esbuild `splitting: true, format: 'esm'` (plus `loader: { '.wasm': 'file' }`) and `await
  import('./perspective-loader')` in the command. Pages that never open the panel load nothing extra. First open: ~5 MB,
  then browser-cached (the Go server serves `public/dist` with cache headers; filenames hashed by esbuild chunks).
  Alternative with no build change: a separate esbuild entry like Speedscope, loaded via a `<script type="module">`
  on demand.
- **Theme:** one `pivot.css` mapping `--psp-*` to Dashica tokens (`frontend/core/style/tokens.css`:
  `--color-surface`, `--color-border`, `--color-accent`, `--font-mono`, …), light and dark.
- **State:** the viewer config (`viewer.save()`) is per widget in `localStorage`, so reopening "Pivot" on the same
  chart restores the grouping. Not in the URL (yet).
- **Size of change:** one extension folder `frontend/extensions/pivot/` (~200 lines), one CSS file, a build-config
  change, four npm packages. No Go change.

### 4.4 Later: Explore's Data tab

When Explore is rebuilt (workbench §6), its "Data" bottom tab is this panel on the widget being edited. "Open in
Explore" carries the `QueryState`; the pivot config could be translated into a Go widget (a `group_by` → a
`NewBarVertical` with `.X(field)`), but only if users ask; that translation is the expensive part.

## 5. Alternatives considered

| Alternative | Why rejected (for now) |
|---|---|
| **A** Perspective as the table widget | rewrite of the table's own features on a moving plugin API; 5 MB per table page; log reading does not need pivots (§4.1) |
| **C** Perspective for all charts | second chart model beside Go's builder; WebGL per small chart; loses Plot's marks (§4.2) |
| Virtual server against ClickHouse (pivot over the whole table, not a result) | creates a `VIEW` in ClickHouse per viewer query (DDL from the UI), its function lists are unverified on ClickHouse, no `split_by`, queries serialized. The browser variant needs ClickHouse credentials in the browser, which Dashica never hands out. A Go-side proxy would mean implementing Perspective's virtual-server protocol in Go (only JS / Python / Rust exist) and bypassing Dashica's filters, field declarations and future permissions (workbench §6) |
| Node/Python `perspective-server` next to Dashica | a second runtime to deploy for a feature in-browser wasm covers at Dashica's row counts (≤100k) |
| Tabulator's own grouping (`groupBy`) in the table | groups rows but has no pivot/aggregate UI; good enough if B turns out unused |
| Do nothing | fair: B is an add-on. Its value is high for "status codes by host by path" questions that today need a new Go widget or SQL in ClickHouse's UI |

## 6. Risks and migration

### Risks

| Risk | Mitigation |
|---|---|
| ClickHouse Arrow types: `DateTime` arrives as `UInt32` seconds, `LowCardinality` maybe as dictionary, `UInt64` beyond 2^53, `Nullable`, `Array` | spike (step 1) on real results; cast in the panel (`tableToIPC` after mapping `UInt32` time columns to `Timestamp`) or set ClickHouse output settings in `HandleQuery` only if the table widget is unaffected |
| Breaking changes between majors (v4→v5 was large) | pin exact versions; the extension is the only importer; its surface is `client.table`, `viewer.load/restore/save`, one event |
| 5 MB first load, wasm in a Web Worker, CSP | lazy chunk; check that the server's CSP allows `worker-src blob:` / `wasm-unsafe-eval` if a CSP is added later |
| Shadow DOM: Dashica's CSS and the search highlight do not reach inside | accepted: the pivot has its own search and filters |
| Selection mapping relies on filter field ids in props (workbench §3.8, not yet built) | step 2 ships without click-to-filter; step 3 adds it once §3.8 exists |
| No browser in the sandbox | each step reviewed by the maintainer in the browser; a Playwright spec opens the panel on a fixture page |

### Steps (each a small commit, reviewable alone)

1. **Spike** (throwaway branch): load one real request-log result (10k rows) and one time-bar result into
   `<perspective-viewer>`; note type issues, load time, memory. Decision point: continue or stop.
2. **`pivot` extension, read-only:** menu entry, bottom panel, lazy chunk, theme mapping, refresh. No filters out.
3. **Click-to-filter** via `widget/selection`, after workbench §3.8 has filter ids in props.
4. **Persisted viewer config** per widget (localStorage).
5. (With the Explore rebuild) the panel becomes Explore's Data tab.

Revisit A only if step 2 shows users reading logs in the pivot instead of the table.

## 7. Open questions

1. **Is ad-hoc pivoting wanted enough to carry 5 MB lazily loaded?** Recommendation: yes, after the spike; the cost
   is paid only on first use, and it answers "regroup by another field" (workbench §7, question 4) without new Go code.
2. **Pivot the chart's result or the raw rows behind it?** Recommendation: the result first (no server change); raw
   rows come with "drill to detail" (workbench §6), which needs the base table and is its own feature.
3. **Bottom panel or a page of its own?** Recommendation: bottom panel with maximize; a separate page needs URL state
   for the viewer config, which is not worth it before Explore.
4. **Lazy chunk via esbuild splitting, or a separate entry like Speedscope?** Recommendation: splitting (one build,
   one `import()`); fall back to a separate entry if splitting conflicts with `go:embed`.
5. **Should local Perspective filters become page filters automatically?** Recommendation: no; only an explicit
   click via the selection bar, so the page state stays visible as chips.
6. **Replace Tabulator's theme now (styling concept §6) or wait for Perspective?** Recommendation: now, with token
   overrides in `table.css`; this concept keeps Tabulator.
