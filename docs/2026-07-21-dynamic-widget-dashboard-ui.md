# Explore View — Dynamic Widget & Dashboard Builder

**Started:** 2026-07-21 · **Last restructured:** 2026-07-22
**Status:** core shipped (serialization, runtime, editor UI); Step 3 (Arrow
Go-side fix) + Step 5 widget-categories done 2026-07-22; next steps in §4.

## 1. Goal & requirements

An **optional Explore view**: an on-demand query/widget builder UI ("Grafana
Explore", but producing Dashica widgets) that can grow into a whole dashboard at
runtime, without recompiling.

1. **Go stays the source of truth** — Explore continuously shows generated Go
   (fluent builder API) for copy/paste "graduation" into the repo.
2. **Low maintenance** — one definition per widget option; JSON, editor form,
   codegen, export all derived.
3. **Adjust compiled dashboards** — open in Explore, tweak with live preview,
   export adjusted Go.
4. **Persistence optional** — without a store, state lives in the browser.
5. **Wired explicitly in `main.go`**, like any dashboard:

   ```go
   d.RegisterDashboardGroup("Explore").
       RegisterDashboard("/explore", explore.New())            // on, no persistence
   //  RegisterDashboard("/explore", explore.New(explore.WithFileStore("./dynamic_dashboards")))
   ```

6. New code in `lib/explore/` + `frontend/explore/`; only small, deliberate core
   adjustments elsewhere.

Rejected approaches (for the record): embedded Go interpreter (yaegi) — RCE by
design, and a form UI needs a structured model anyway; hand-written parallel
JSON schema — drift; frontend-only Go-snippet generator — no live preview.
Also rejected: SQL parsers (sqlglot/polyglot) — **ClickHouse itself is the SQL
brain** (`DESCRIBE` for result schemas, `EXPLAIN` for validation); our SQL
contains placeholders/params no parser handles.

## 2. Architecture (as built)

### 2.1 Serialization: derive everything from the existing structs

No parallel "spec" model, no restructuring. Widget structs keep their private
fields byte-for-byte; **`cmd/dashica-gen`** (`go/packages` + `go/ast` +
`go/doc`, run via `//go:generate` like templ) parses each registered widget
struct — field types AND doc comments — and emits `zz_generated.dashica.go`
**in the same package** (generated code reads unexported fields; no accessors,
no reflection). Per widget it emits:

1. strict `MarshalJSON`/`UnmarshalJSON` (unknown JSON keys = error),
2. an **editor descriptor** (field order, editor kind inferred from Go type,
   doc comments as help texts) consumed by `/api/formmodel`,
3. (gocode tables — deferred to the gocode step, §4.4).

Generated files are gitignored and regenerated on build (templ convention;
`.mise/tasks/build/_default` runs `go generate ./...`). The generator fails
loudly on unsupported field types. Defaults are not parsed from source: the
registry factory builds a zero-value widget and marshals it.

Only two unavoidable indirections:

| Problem | Solution |
|---|---|
| Interface-typed fields (`WidgetDefinition`, `SqlQueryable`, `SqlField`) | Tagged envelope + registry (`{"type": "timeBar", "props": {...}}`; children nest inside their parent's `props`) |
| Function-typed `LayoutFunc` | Named layouts: `layout.Layout{Name, Fn}` + registry; JSON stores the name |

The `sql` package keeps its type structure; hand-written serializers in one
`serialization.go` (deliberate exception — small stable vocabulary), tagged
wire forms `{"kind": "expr"|"count"|"enum"|"autoBucket", ...}` and
`{"kind": "table"|"file"|"raw", ...}`, plus `Marshal/UnmarshalField|Queryable`
helpers the generated code calls.

**Field kinds are constructor tags, not a semantic taxonomy.** The rule:
`kind` ≡ "which Go constructor produced this field", 1:1, so the code
generator emits the idiomatic call (`sql.Count()`, never
`sql.Field("count(*)")`) and the wire format can never express anything the Go
API cannot (a semantic decomposition like `{column, aggregate?, timeBucket?}`
was considered and rejected exactly because it could). Semantics live one
layer up: intent labels and column classes in the formmodel. Two consequences,
tracked in §4 Step 2:
- every constructor needs a kind — today `Timestamp15Min`/`TimestampField`/
  `JsonExtractString` degrade to `expr` with baked SQL (round-trip-safe but
  lossy for codegen and forms);
- kinds should carry their constructor's *arguments* (`enum` → `column`), not
  the baked SQL output (`definition: "level::String"`).
Gaps in the Go API surface here as missing kinds by design — e.g. Y-axis
aggregations beyond count (`sql.Sum(col)`, `sql.Avg(col)`, …) don't exist as
constructors yet, so "sum of a column" currently forces the `expr` escape
hatch; the fix is new constructors (backlog), after which kind + intent label
follow mechanically.

`sql.FromString` (inline SQL, same `{{DASHICA_FILTERS}}` enforcement) exists
for Explore's raw-SQL mode.

Wire-format example (round-trips to/from the identical builder chain):

```json
{"type": "timeBar", "props": {
  "sql":  {"kind": "table", "table": "full_logs", "where": ["level = 'error'"]},
  "x":    {"kind": "autoBucket", "column": "timestamp", "alias": "time"},
  "y":    {"kind": "count", "alias": "logs"},
  "fill": {"kind": "enum", "column": "level"},
  "title": "Error / Fatal Logs", "height": 150
}}
```

**Round-trip invariant, enforced by tests:** `unmarshal(marshal(d))` yields
identical chartProps JSON and built SQL for every dev-server example dashboard
(`serialization_equiv_test.go`, `serialization_roundtrip_test.go`, with
completeness guards for new widgets).

Core adjustments that rode along: `dashboard.Dashboard` interface shrunk to
`Title() + CollectHandlers()` (fluent API lives on concrete `*Builder`);
`dashboardImpl→Builder` serialization via DTO; column introspection extended
(`IntrospectedSchema.Columns` with name/type/comment/**class** per table).

### 2.2 `lib/explore` runtime

`explore.New()` implements `dashboard.Dashboard`; all routes hang under the
registration URL:

| Route | Purpose |
|---|---|
| `GET /explore` | Editor page (full-screen `layout.ExplorePage`) |
| `POST …/api/preview/render` | Widget JSON → the widget's **own `BuildComponents` HTML** (`UntrustedContent` set) |
| `POST …/api/preview/query` · `…/debug` | Widget JSON → replay its own `CollectHandlers` against an in-memory `capturingCollector`, dispatch to the captured handler — **the identical compiled query path**, no parallel engine |
| `GET …/api/formmodel` | Generated descriptors + runtime defaults + layouts + `fieldKinds` intent vocabulary |
| `GET …/api/schema` | Tables + columns (type, comment, class) |
| `GET …/api/values?table=&column=` | Top distinct values (identifier-validated) |

**Trust model:** widgets arriving as JSON are untrusted →
`DashboardContext.UntrustedContent = true` on every Explore-built context.
Markdown drops `html.WithUnsafe()` when untrusted (raw-HTML XSS closed) and
**refuses `File()` entirely when untrusted**; trusted `File()` reads only
projectFS (`fs.ValidPath`, no host FS). Otherwise Explore adds no DB exposure
the search bar didn't already have (raw SQL from browser); the real boundary
stays the ClickHouse user's permissions (read-only user recommended).

### 2.3 Frontend (`frontend/explore/`)

**Not idiomatic Alpine, deliberately** (CSP build forbids expressions with
arguments; recursive schema forms don't fit templates). Since 2026-07-22 it
runs on Alpine's reactive engine **headlessly** (`Alpine.reactive`/`effect`/
`release`/`raw`): two reactive roots (`state`, `ui`), one named effect per
derived surface (persist / tree / inspector / per-card preview / drawer);
controls write straight into the reactive props proxy — no `onChange`
plumbing. Guardrails that keep it sane (do not regress these):

1. inspector effect depends only on `(selectedId, widget.type)` — props are
   read untracked inside controls, so typing never rebuilds the form;
2. text inputs are only written when not focused;
3. preview effects track `JSON.stringify(props)` coarsely, debounced;
4. per-widget effects are `Alpine.release`d on removal;
5. one effect per surface, never nested.

**Preview pattern (protect this):** the server renders the widget's real
markup; the real `chart` component takes over via
`data-preview-base`/`data-preview-body` — chartProps, debug drawer (wrench =
SQL/EXPLAIN) and time-range reactivity have exactly one implementation, shared
with compiled dashboards.

**Form rendering:** generic `formRenderer.ts` walks the descriptor — zero
per-widget UI code; `controls.ts` has one control per editor kind (text / int /
bool / select / field picker / query section / colorScale / keyValue /
stringList / group). Form libraries evaluated and rejected (JSONForms & co. =
React/Vue; json-editor = replaces only the trivial 20 %). SQL inputs currently
`<input>`+`<datalist>`; CodeMirror deferred (§4.8). DOM assembly should move
to the **`htl` `html` tag already in the bundle** (§4.5).

**UX (as built):** full-screen Neos-style layout — tree left, full dashboard
preview centre (time-range strip as the preview's sticky header — it *is* the
previewed dashboard's state), inspector right, bottom drawer **Data / Go code /
JSON** (SQL tab dropped: the chart's wrench covers it). Data tab = columns
pane (badge/name/type/comment) + live sample rows via a synthetic
`{type:"table"}` envelope through the normal preview path + per-column top
values. Field pickers speak **intent** ("Time bucket (automatic)", "Row
count", "Column (as category)"; expression + alias behind Advanced), with the
**column-class vocabulary temporal ⏱ / categorical 🏷 / continuous #**
classified server-side (`ClassifyColumnType`, one home) and used for
slot-aware, badged column completion. Golden path: pick a table → X/Y
auto-seeded → chart renders. State: localStorage autosave + base64 share-link
hash; JSON power-user tab.

### 2.4 Maintenance cost (the point of all of the above)

| Change | Work | Derived automatically |
|---|---|---|
| New option on a widget | 1 struct field + 1 builder method + `go generate` | JSON, form (incl. doc-comment help), preview, codegen, export |
| New widget type | struct + behavior (needed anyway) + 1 registry line | everything else |
| New `sql` field kind | constructor + kind stamp + serializer + emitter case (~20 lines) | — |
| New layout | 1 registry entry | — |

## 3. Status — what is done

- **Serialization foundation** (was Phase 1): sql serializers + kind stamps +
  `FromString`; widget envelope/registry (13 v1 types); named layouts;
  dashboard DTO; `dashica-gen` (serializers + descriptors); round-trip tests
  green; go:generate/gitignore/mise wiring.
- **Runtime** (was Phase 2): `explore.New()`; preview query/debug/render via
  capturing-collector replay; formmodel/schema/values endpoints; markdown
  trust fix (`UntrustedContent` + projectFS-only `File()`, tests).
- **Editor UI** (was Phase 3): three-pane editor + controls + server-rendered
  preview through the real `chart` component; wired into both `register_*.go`
  variants + dev-server; **reactive-dataflow rewrite** (closed the stale-
  preview/stale-datalist/forgotten-persist bug class by construction);
  **full-screen layout**, **Data tab**, **intent field pickers + column
  classes**.
- Review fixes landed along the way: share-link XSS, render-plumbing
  amplification, unvalidated state swallow, markdown `file` blocker,
  `start()` failure mode.
- **Arrow-incompatible types** (Step 3): transport-level `ensureArrowCompatible`
  in `lib/clickhouse` (DESCRIBE + `SELECT * REPLACE(toString(...))` wrap);
  client-side stop-gap removed. Unit tests green; e2e needs dev ClickHouse.
- **Widget categories** (Step 5, first bullet): `chart|parameter|container`
  registry hint → generated descriptor → add-widget list shows charts only.

Recurring gap: **frontend build + browser E2E have been deferred at the end of
every slice** — no automated browser test exists yet.

## 4. Next steps — in order

Each step is a shippable slice. Order = dependencies first, then user value.

**Step 1 — Browser E2E harness.** STARTED 2026-07-22: Playwright suite written
(`playwright.config.ts`, `e2e/explore.spec.ts`, `e2e/README.md`; npm scripts
`e2e`/`e2e:ui`; `@playwright/test` devDependency — user runs `npm install` +
`npx playwright install chromium`). Covers: editor shell, chart-only add list,
golden path (add + table → chart), WHERE editing, Data tab, values, JSON tab,
share link. Known bugs B1–B4 below are encoded as `test.fail(...)` tests —
they flip loudly when fixed, then the marker is removed and the assertion
stays as a regression test. Still to run once installed.

### Browser-session findings (2026-07-22) — feed the steps below

From driving the real editor on `127.0.0.1:8081` (dev ClickHouse,
`mv_agent_metrics`). B1–B4 have `test.fail` e2e tests.

**B5 — WHERE needs a scope explanation** (user request). Add help text on the
Where section: *"Applies only to this widget's query — combined with the
dashboard-wide time range and filters (top of the preview), which apply to
every widget."* Doc-comment or formmodel-served so wording lives in Go.

**B6 — "Filter from data" (user request).** Right-clicking a value in a table
widget / Data-tab sample should offer "Filter: `column = 'value'`" —
appending to the **selected widget's WHERE**, not the global filter bar.
Design: small custom context menu on table cells + Data-tab values; inserts
into the widget envelope's `where` list (reactive state makes this one
mutation). Same affordance left-click on a Data-tab *values* row (B7).

**B7 — values list is display-only.** Clicking a value does nothing; it
should insert `column = 'value'` as a widget WHERE clause (or at least copy).

**B8 — Title input collapsed to 15 px.** `.explore-toolbar__title` renders as
an unusable sliver ("mystery box"); placeholder exists but the flex sizing is
broken.

**B9 — No loading state in preview cards.** After edits, the card can sit
blank (in-flight fetch) with no spinner — indistinguishable from "no data".
Compiled dashboards have a refresh indicator; reuse it. Also add an explicit
"no rows in range" empty state.

**B10 — Tree icon buttons nearly invisible** on the selected row (pale blue
on blue; ↑ ↓ × only readable when zoomed).

LATER - NOT RIGHT NOW!!! **Step 2 — Serialization "fails loudly" sweep (open Phase-1 review findings).**
The invariant everything rests on: *round-trips faithfully or fails loudly.*
- ✋ `dashica-gen/load.go`: hard-error when a `Register(...)` factory type
  cannot be resolved (currently silently skipped → widget marshals empty
  props); test cross-check: every registered type implements `json.Marshaler`.
- ✋ skipped fields (`id`, `markdown.assets`) are silently lossy: generated
  `MarshalJSON` errors (or warns collectably) when a skipped field is
  non-zero; decide whether `id` should serialize.
- ⚠ sql DTOs: strict per-kind key checks in `UnmarshalQueryable`/`Field`
  (wrong-kind or unknown keys currently vanish — widget layer is strict, sql
  layer isn't).
- ⚠ reflect-based drift-guard test on `SqlQuery`/`SqlFile`/`SqlString` DTO
  coverage (hand-written serializers have no loud-failure path today).
- ⚠ searchBar wire format: own DTO in the dashboard package instead of
  leaking `rendering.SearchBarOption`'s PascalCase field names.
- ⚠ invert the trust flag: `TrustedContent` (zero value = untrusted), set at
  the single compiled-context site in `dashica.go` — forgetting becomes
  fail-safe.
- ⚠ **constructor-faithful wire kinds** (see §2.1): kinds carry constructor
  *arguments*, not baked SQL — `enum` carries `column` (server builds the
  `::String` cast via the real constructor); add the missing kinds for
  `Timestamp15Min`/`TimestampField`/`JsonExtractString` (currently lossy
  `expr` degradation); per-kind seeds served in the formmodel. Kills the last
  one-source-of-truth violation — the client-side `seed()` currently
  hardcodes `count(*)`, `::String`, `alias:'time'` (survived every review
  round). Includes a stored-state migration: versioned localStorage key +
  drop unknown prop keys against descriptors on load (client tolerant,
  server strict).

**Step 4 — Go code generation (the missing core requirement #1).**
`lib/explore/gocode.go` + `POST /api/gocode` + live Go-code drawer tab.
Emitter: `dashica-gen`'s gocode tables (field↔builder-method verified at
generation time; `//dashica:gocode` overrides) + per-type value emitters
(`sql.AutoBucket("ts")`, `sql.New(sql.From(...))`, `color.New(...)`); stdlib
`text/template` + `go/format` (jennifer evaluated and dropped — trivial fixed
import set). Must handle **multi-arg constructors** (`NewCheckboxGroup(name,
label, options)`) or those widgets emit non-compiling Go (known finding).
Tests: golden files + **CI compile check** of generated code + marshal-back
round trip.

**Step 5 — Editor polish batch (cheap, visible).**
- UX polish: persistent labels on every input; labeled title/layout in the
  toolbar; tree rows show `props.title`; Fill/Fx/Fy collapsed
  into "Series & faceting".
- keyValue control: commit key+value atomically on blur (phantom-key bug).
- values endpoint: time-bound the scan (schema knows the timestamp column)
  — currently full-table GROUP BY per autocomplete call; add continuous-column
  min/max/quantiles as the class-appropriate alternative.
- API error semantics: 400 vs 500 split in `apiHandler` so the editor can
  show inline vs toast.
- Small robustness: `destroyTree` fallback (private Alpine API), `lz-string`
  share links + length warning.

**Step 6 — Open existing (compiled) dashboards in Explore. DONE 2026-07-22.**
"Open in Explore" link on every standard dashboard page (top of main content,
rendered only when Explore is registered). Mechanism: each `*Builder` registers
its own `<dashboard-url>/open-in-explore` handler (no lookup registry — the
dashboard has itself), which marshals itself and 302-redirects to
`<exploreURL>#s=<base64>` — the editor's existing share-link loader reconstructs
it, zero frontend logic. The Explore URL is discovered order-independently: the
registrar marks the Explore view via an `IsExploreView()` marker and every
`DashboardContext` carries a shared `*ExploreBaseURL` pointer (nil/empty ⇒ no
button). Out-of-v1-scope widgets are **skipped** (chosen over placeholder/whole-
export error): `widget.ErrWidgetNotRegistered` sentinel + a mutex-serialised
lenient-marshal mode threaded through `Widgets`/`WidgetsMap.MarshalJSON`, so an
unsupported widget nested in a grid/collapsibleGroup drops **only that child**,
the container survives. Skipped widgets are logged server-side. Strict
`MarshalJSON` unchanged (round-trip invariant intact). Encoding note: the
fragment base64 is query-escaped because the editor reads it via
`URLSearchParams` (`+`→space otherwise). Tests: `dashboard_explore_test.go`
(top-level + nested skip, all-supported, strict-still-fails) +
`dashboard_openinexplore_test.go` (redirect state round-trips, 404 when Explore
unregistered), race-clean.

**Step 7 — Optional persistence.**
`Store` interface + JSON-file store (`WithFileStore(dir)`, write-temp+rename;
`WithReadOnly()` for prod); `GET /explore/d/{slug}` request-time rendering with
per-widget query dispatch (deterministic ids from tree position); CRUD API.
Sidebar integration via generic `rendering.Tag{Label, Color}` pills on
`MenuGroupEntry` (`#dyn`; usable by compiled dashboards too), appended to a
per-request copy of the menu. Add a bluemonday pass for markdown link URLs
(`javascript:` links) once other-user content is stored. ClickHouse-backed
store later behind the same interface.

**Step 8 — Nested widgets + WYSIWYG grid designer.**
Children editing in tree + inspector: **DONE 2026-07-22** (first half; WYSIWYG
grid designer NOT started). Container widgets (grid, collapsibleGroup) are now
addable at top level; their children are edited from the inspector's
`childrenList` (Widgets slice, reorderable) / `childrenMap` (WidgetsMap keyed by
area name) controls and shown nested in the tree. Mechanism: the generator now
emits distinct `childrenList` / `childrenMap` editor kinds (was a single
placeholder `children`) so the frontend knows list-vs-map without guessing;
selection became a **path** (`w3/areas/main`, `w3/widgets/0`, nestable), resolved
by `resolveNode()` to `{node, topId, parent}`; add/remove/move/type-switch live
in the editor (single source), exposed to the pure-view control via `ChildrenApi`.
Preview cards stay per top-level widget — a child's selection highlights/scrolls
its top-level ancestor. **Tree drag-and-drop:** any row can be dragged onto a
container row to move it inside (top-level widget → grid, or between containers;
cycle-guarded); top-level rows still drag-reorder among themselves
(`wireRowDnd`/`moveNodeIntoContainer`/`extractNode`). **Grid area naming is
automatic** — children are assigned positional area names (1st `a`, 2nd `b`, …
via `nextAreaName`), so the grid needs no area/template configuration: Go-side,
`Grid.resolvedTemplate()` stacks the sorted areas one-per-row when no explicit
`Template()` is set (explicit 2D templates on compiled dashboards still win). All
reactive guardrails preserved (tree/inspector effects
read only structural bits — types + container membership — so scalar edits don't
rebuild them; verified by construction). **Known limitation (deferred, overlaps
the visual/preview slice):** the in-editor live preview renders a container's
layout, but nested child chart *data* does not load — `preview/query` dispatches
by endpoint suffix (`findBySuffix("/query")`), which is ambiguous for a
multi-child container, and the client wires only the first `[x-data="chart"]`.
Correct nested-child data needs per-child preview dispatch (a preview-plumbing
extension). Serialization / "Open in Explore" round-trip / (future) Go export of
nested widgets are unaffected. Next: the visual grid editor:
`grid-template-areas` = named rectangles on a cell matrix
(`{cols, rows, areas:[{name,r0,c0,r1,c1}]}`); overlay on the *real* preview
grid (CSS aligns it); rubber-band create / edge-drag resize / body-drag move,
rectangles enforced by construction; plain pointer events (~300–400 lines).
Tree drag-sort for top-level order. CodeMirror upgrade for the three SQL
inputs (whereClause, rawSql, custom expression: highlighting, schema-fed
completion, inline EXPLAIN errors) fits here or in Step 5 if the datalist
UX pinches earlier.

**Backlog (unordered, small):** aggregation constructors in the Go sql API
(`sql.Sum(col)`, `sql.Avg`, `sql.Min/Max`, `sql.Uniq`, …) — unlocks Y-axis
beyond count without the `expr` escape hatch; kinds + intent labels follow
mechanically per §2.1; `?database=` param for schema/values
(multi-server queries); configurable table-name filter in
`introspect_schema.go` (Sandstorm prefixes hardcoded in the generic lib);
introspection cache TTL + a deliberate look at the odd common-columns
condition (`columnsPerTable[column]`); shared `isJSONNull` if a third copy
appears; searchBar default-visible semantics on unmarshal.

## 5. Out of scope

Alert-definition editing (alerts.yaml pipeline unchanged) · per-user
ownership/permissions · in-place override of compiled dashboards ·
multi-replica write coordination · Go interpreter. Widget coverage v1: chart
widgets + markdown + grid + multiColumn + collapsibleGroup + checkboxGroup +
textInput; alert widgets / schemaTable / speedscopeLink later.
