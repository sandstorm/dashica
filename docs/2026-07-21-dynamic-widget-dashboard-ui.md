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

LATER - NOT RIGHT NOW!!! **Step 1 — Browser E2E harness (pay the recurring debt first).**
Playwright/Chrome-MCP smoke: load `/explore`, add timeBar, pick table, see
rendered chart, edit JSON tab, share-link round-trip. Every later step extends
this instead of re-deferring it. (Frontend build stays the user's command; the
tests assume a built bundle + dev ClickHouse.)

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

**✅ Step 3 — Arrow-incompatible ClickHouse types, Go-side (DONE 2026-07-22).**
CH cannot serialize `JSON`/`Object`/`Dynamic`/`Variant` to Arrow → any
`SELECT *` over `full_logs` (`event_original JSON`) failed.
Built: `lib/clickhouse/arrow_compat.go` — `ensureArrowCompatible` in
`QueryToHandler` (the only Arrow path). No-op unless `Format=="Arrow"`;
`DESCRIBE (<query>)` (same params, no cache) → if the *result* has affected
columns, wrap `SELECT * REPLACE(toString(`c`) AS `c`, …) FROM (<query>)`.
Names/order/other types preserved; works for table/file/raw, compiled +
dynamic, no SQL parsing. Trailing `;` stripped before wrapping
(`trimTrailingSemicolons` — a real bug hit on first run: `DESCRIBE (…;)` is a
syntax error). FE stop-gap removed: `sampleQuery()` reverted to the plain
`{kind:'table', table}` envelope. Tests: unit (detection regex, wrap SQL,
trim) green; e2e (`clickhouse_e2e_test.go`: `SELECT *` over `full_logs`
through `QueryToHandler` succeeds where raw Arrow errors; ORDER BY row-order
survives the wrap) — **needs dev ClickHouse; blocked in the sandbox
(`connect: operation not permitted`), user must run**. Contingency if order
ever lost: `SETTINGS max_threads=1` on wrapped queries only (not needed yet).

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
- ✅ **DONE 2026-07-22** — Widget **categories** `chart | parameter |
  container`: single registry hint = 3rd arg to `widget.Register(name,
  Category, factory)` (`WidgetCategory` const in `registry.go`), read straight
  from the AST by `dashica-gen` (`constStringValue`) → `WidgetDescriptor.Category`
  → served in `/api/formmodel`. Editor add-widget dropdown lists only
  `category==='chart'`; parameter (textInput, checkboxGroup) and container
  (grid, collapsibleGroup) widgets stay registered/serializable (compiled +
  "Open in Explore" round-trip) but hidden from the flat list. Tests:
  `formmodel_test.go` asserts category per widget. Later: teach the query
  section to reference `{param:String}`, then surface parameter widgets.
- UX polish: persistent labels on every input; labeled title/layout in the
  toolbar; tree rows show `props.title`; icon contrast; Fill/Fx/Fy collapsed
  into "Series & faceting"; friendly empty states instead of raw 500 text.
- keyValue control: commit key+value atomically on blur (phantom-key bug).
- Adopt `htl` for DOM assembly (already a dependency; ~halves
  controls/editor boilerplate).
- values endpoint: time-bound the scan (schema knows the timestamp column)
  — currently full-table GROUP BY per autocomplete call; add continuous-column
  min/max/quantiles as the class-appropriate alternative.
- API error semantics: 400 vs 500 split in `apiHandler` so the editor can
  show inline vs toast.
- Small robustness: `destroyTree` fallback (private Alpine API), `lz-string`
  share links + length warning.

**Step 6 — Open existing (compiled) dashboards in Explore.**
"Open in Explore" action on every dashboard page (rendered only when Explore
is registered): server marshals the registered dashboard → editor loads it as
client-side state (no store needed). Decide the behavior for
out-of-v1-scope widgets (alert widgets, schemaTable, speedscopeLink):
skip-with-placeholder vs. whole-export error (`MarshalWidget` currently errors
— loud but all-or-nothing). Accepted limitation: template helpers
(`templates.LogOverview(...)`) export flattened. No in-place override of
compiled dashboards — compiled = immutable truth.

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
Children editing in tree + inspector, then the visual grid editor:
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
