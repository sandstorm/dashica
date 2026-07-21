# Dynamic Widget & Dashboard Builder UI — Design Plan

**Date:** 2026-07-21
**Status:** DRAFT — plan only, nothing implemented yet

## 1. Goal

Add an **optional** UI to Dashica that lets users build a widget (and later a whole
dashboard) **dynamically at runtime**, without recompiling the Go binary.

Hard requirements from the problem statement:

1. **Go stays the source of truth.** A dynamically built dashboard must be exportable
   as idiomatic Go code (the existing fluent builder API), so people can copy/paste it
   into the repository and "graduate" it to a compiled dashboard.
2. **Maintenance cost must stay low.** Dashica's widget API grows constantly (new
   widgets, new options on existing widgets). The dynamic layer must not require
   hand-maintaining parallel definitions (JSON schema + form + parser + code
   generator) for every option.
3. **Adjusting existing, compiled dashboards** should be possible: open a Go-defined
   dashboard in the editor, tweak it, and either keep the tweaked copy as a dynamic
   dashboard or export the adjusted Go code.
4. The whole feature is **opt-in** (config flag); Dashica without it behaves exactly
   as today.

## 2. Relevant facts about the current architecture

Understanding these is what makes the recommended design cheap:

- **The frontend is already fully data-driven.** Every chart widget renders via
  `widget_component.Chart(widgetBaseUrl, chartType, chartPropsJSON, height)`
  (`lib/components/widget_component/chart.templ`). The Alpine.js `chart` component
  (`frontend/components/chart.ts`) picks a renderer from a `charts = {timeBar, timeLine,
  barVertical, ...}` map, fetches data from `<widgetBaseUrl>/query`, and renders. The
  browser never sees Go — it sees **(chartType, chartProps JSON, a query URL)**.
- **A Go widget is a thin, typed factory for exactly three artifacts:**
  1. `chartProps` JSON (see e.g. `TimeBar.buildChartProps()` in
     `lib/dashboard/widget/time_bar.go`),
  2. an `sql.SqlQueryable` (built in `buildQuery()` from the base query plus the
     X/Y/Fill/... fields),
  3. HTTP handlers `<id>/query` + `<id>/debug`, registered via the shared helper
     `RegisterQueryHandlers` (`lib/dashboard/widget/widget_common.go`).
- **Queries are already structured data.** `sql.SqlQuery` holds `selectF / from /
  where / groupBy / orderBy / limit / database / ...` as plain fields
  (`lib/dashboard/sql/sql_builder.go`). `sql.SqlFile` is a path + where-clauses +
  flags. Field constructors (`sql.AutoBucket`, `sql.Count`, `sql.Enum`, `sql.Field`,
  ...) produce small structs of `{definition, alias, xBucketSizeMs, column}`.
- **Routing is static, but only by convention.** `handler_collector` registers
  everything on a `http.ServeMux` at boot. Nothing prevents mounting *one* prefix
  handler at boot that dispatches dynamically at request time.
- **Dashboard-level filters arrive at request time anyway.** Time range and the
  search-bar SQL filter are applied per request in `httpserver.QueryHandler.HandleQuery`
  — a widget's query object is a *template*, already re-evaluated per request.
- **The search bar already sends raw SQL from the browser** (`sqlFilter` becomes a
  `WHERE` clause). The security model therefore already assumes: *anyone who can reach
  the Dashica UI can run arbitrary SQL with the ClickHouse user's permissions.* A
  dynamic builder does not materially expand the database threat model.
- **Schema introspection already exists** (`lib/clickhouse/introspect_schema.go`,
  `frontend/util/schema.ts`, the `SchemaTable` widget) — usable for column pickers
  and autocomplete in the editor.

**Consequence:** the missing piece is not a new rendering stack. It is a
**serializable description ("spec") of what the Go builders currently hold in
unexported fields**, plus a runtime that turns a spec into the same three artifacts,
plus a code generator that turns a spec back into builder calls.

## 3. Options considered

### Option A — Embedded Go interpreter (yaegi or similar)

Store dashboards as actual Go source, interpret at runtime. Go text is literally the
storage format; export = the file itself.

Pros:
- Zero translation layers; copy/paste requirement trivially satisfied.
- Full expressiveness (loops, helper functions like `templates.LogOverview`).

Cons — and these are decisive:
- **Security regression.** Today the UI can inject SQL; an interpreter means the UI
  can execute arbitrary Go (filesystem, network, `os/exec`). That is RCE by design and
  a categorically bigger blast radius than the current model. Sandboxing yaegi
  properly (restricting symbols) is fiddly and easy to get wrong.
- **A form-based builder still needs a structured model.** "Build a widget in a UI"
  means forms/pickers, not only a code textarea. Forms editing Go *text* require
  parsing arbitrary Go into a structured model and writing it back — an AST round-trip
  problem far harder than everything else in this plan combined.
- **Ecosystem risk.** yaegi historically lags Go releases (generics support arrived
  late and partially), inflates the binary, and requires maintaining symbol-export
  tables for the `dashica` packages.
- Adjusting *compiled* dashboards is not helped at all: the compiled binary does not
  contain their source in interpretable form.

**Rejected.** May be revisited later as an optional "escape hatch" for power users,
but it does not solve the core problem (a structured, form-editable model) and it
breaks the security model.

### Option B — Hand-written parallel JSON schema + parser + form + codegen

The naive approach: define a JSON format, write an unmarshaller into widgets, write
form components per widget, write a code generator per widget.

**Rejected** — violates requirement 2. Every new widget option would need edits in
4–5 places; the layers would drift apart within months.

### Option C — Spec structs as the single source of truth (recommended)

Refactor each widget so its configuration lives in **one exported, JSON-taggable
"spec" struct** instead of loose unexported fields. Everything else derives from that
one definition:

- JSON (de)serialization → `encoding/json`, free.
- UI form / validation → JSON Schema generated by reflection over the spec structs.
- Runtime instantiation → `widget.FromSpec(spec)` reads the same struct the builder
  methods write.
- Go code generation → a *generic*, reflection-driven emitter: one builder-method
  call per non-zero spec field.
- Export of compiled dashboards → `w.Spec()` is a getter, because the widget's
  internal state *is* the spec.

Adding a new option = add one field to the spec struct + one 3-line builder method.
JSON, form, codegen, and export all pick it up automatically.

**Chosen.** The rest of this document details Option C.

### Option D — Frontend-only builder that just emits Go code text

No server-side dynamic execution; the UI is a "Go snippet generator".

**Rejected as the main approach** (no live preview without executing the query, no
persistence, no adjustment of existing dashboards), but its code-generation part is
exactly Phase 3 of the chosen plan.

## 4. Recommended architecture

### 4.1 Spec model (`lib/dashboard/spec` or alongside existing packages)

Serializable, versioned description of a dashboard. Shape mirrors the builder API
1:1 — deliberately, so the Go-code export is a mechanical mapping.

```go
// DashboardSpec is the serializable form of dashboard.Dashboard.
type DashboardSpec struct {
    Version       int              `json:"version"` // schema evolution
    Title         string           `json:"title,omitempty"`
    HasSearchBar  *bool            `json:"hasSearchBar,omitempty"` // nil = default true
    FilterButtons []FilterButton   `json:"filterButtons,omitempty"`
    Widgets       []WidgetSpec     `json:"widgets"`
    // Layout stays a named reference ("defaultPage", "docsPage"), resolved via a
    // registry — LayoutFunc itself is code and must not be serialized.
    Layout        string           `json:"layout,omitempty"`
}

// WidgetSpec is a tagged union: Type selects the entry in the widget registry;
// Props holds the widget-specific spec struct; Children covers container widgets.
type WidgetSpec struct {
    Type     string                `json:"type"`            // "timeBar", "table", "grid", ...
    Query    *QuerySpec            `json:"query,omitempty"` // nil for markdown/grid/...
    Props    json.RawMessage       `json:"props,omitempty"` // decoded via registry
    Children map[string]WidgetSpec `json:"children,omitempty"` // grid areas, groups
}

// QuerySpec is the serializable form of the *base* query handed to a widget
// (widgets keep deriving SELECT/GROUP BY from their field props, as today).
type QuerySpec struct {
    // exactly one of File / Table / RawSql is set
    File        string      `json:"file,omitempty"`   // sql.FromFile (projectFS path)
    Table       string      `json:"table,omitempty"`  // sql.New(sql.From(...))
    RawSql      string      `json:"rawSql,omitempty"` // NEW: sql.FromString(...)
    Where       []string    `json:"where,omitempty"`
    Database    string      `json:"database,omitempty"`
    SkipFilters bool        `json:"skipFilters,omitempty"`
    AutoBucket  bool        `json:"autoBucketPlaceholder,omitempty"`
}

// FieldSpec is the serializable form of sql.SqlField / TimestampedField.
type FieldSpec struct {
    Kind          string `json:"kind"` // "field", "autoBucket", "count", "enum",
                                       // "timestamp15Min", "jsonExtractString", ...
    Column        string `json:"column,omitempty"`     // autoBucket, enum
    Definition    string `json:"definition,omitempty"` // kind=field
    Alias         string `json:"alias,omitempty"`
    XBucketSizeMs int64  `json:"xBucketSizeMs,omitempty"`
    Paths         []string `json:"paths,omitempty"`    // jsonExtractString
}
```

And per widget, e.g.:

```go
// TimeBarProps — one struct, one place. Builder methods write into it;
// FromSpec reads it; JSON-Schema generation reflects over it; the Go-code
// emitter walks it.
type TimeBarProps struct {
    Title        string             `json:"title,omitempty"`
    Height       int                `json:"height,omitempty"`         // default 200
    Width        *int               `json:"width,omitempty"`
    X            FieldSpec          `json:"x"          ui:"required,timestamped"`
    Y            FieldSpec          `json:"y"          ui:"required"`
    Fill         *FieldSpec         `json:"fill,omitempty"`
    Fx           *FieldSpec         `json:"fx,omitempty"`
    Fy           *FieldSpec         `json:"fy,omitempty"`
    MarginLeft   *int               `json:"marginLeft,omitempty"`
    // ... margins, color, tipChannels, stack — all existing options
}
```

**Widget-internal refactor:** `TimeBar` (and each widget) replaces its ~15 unexported
fields with `props TimeBarProps` + the (unchanged, still immutable) builder methods
writing into it. `buildChartProps()` / `buildQuery()` read from it. Public builder API
is 100 % source-compatible; only internals move. This refactor is mechanical and can
be done widget-by-widget.

Notes:
- `color.ColorScale` and `StackOptions` need small serializable forms too
  (`ColorSpec`, `StackSpec`); both are already nearly-plain data.
- `FieldSpec` may even *become* the canonical implementation of `sql.SqlField`
  (constructors in `fields.go` return it), deleting `fieldImpl` /
  `autoBucketFieldImpl` duplication. Optional simplification — decide during Phase 1.
- `sql.FromString(content string)` is a small new `SqlQueryable`: behaves exactly
  like `SqlFile` but with inline content (same `{{DASHICA_FILTERS}}` enforcement).
  Needed because the dynamic UI cannot write files into the embedded projectFS.
  It is also useful for compiled dashboards, independent of this feature.

### 4.2 Widget registry

One small registration point per widget type:

```go
// lib/dashboard/spec/registry.go
type WidgetType struct {
    Name      string                       // "timeBar"
    Props     func() any                   // returns *TimeBarProps (for decode + schema)
    FromSpec  func(q sql.SqlQueryable, props any, children map[string]widget.WidgetDefinition) (widget.WidgetDefinition, error)
    GoBuilder GoBuilderInfo                // e.g. constructor name "widget.NewTimeBar"
}
```

The registry drives: JSON decoding of `WidgetSpec.Props`, JSON-Schema for the editor,
instantiation, and code generation. Adding a **new widget** = spec struct + this one
registry entry + the frontend renderer (which is already required today).

Layouts get an analogous, much smaller registry: `{"defaultPage": layout.DefaultPage, ...}`.

**Scope of v1 widget coverage:** all chart widgets (timeBar, timeLine, barVertical,
barHorizontal, timeHeatmap, timeHeatmapOrdinal, stats, table), plus markdown, grid,
multiColumn, collapsibleGroup, checkboxGroup, textInput. Alert widgets
(alertOverview/alertDetail), schemaTable and speedscopeLink can follow later — they
have extra dependencies (alert store, profiling) and are rarely what people prototype.

### 4.3 Round-trip: builder ⇄ spec

- `widget.FromSpec(ws WidgetSpec)` → `WidgetDefinition` (via registry).
- New method on widgets and `dashboard.Dashboard`: `Spec() (DashboardSpec, error)`.
  Because internal state *is* the spec structs, this is essentially a getter plus
  query introspection (`SqlQuery`/`SqlFile`/`SqlString` each expose their `QuerySpec`).
- **Invariant, enforced by tests:** `FromSpec(d.Spec())` produces identical
  chartProps JSON and identical built SQL for every example dashboard. This is the
  contract that keeps the dynamic and compiled worlds from drifting.

Known, accepted limitation: exporting a compiled dashboard **flattens abstractions**.
`templates.LogOverview(sql.Where(...))` exports as its expanded widget list, not as a
call to the template function. For "adjust and re-export" workflows that is fine; the
human can re-introduce the helper call when pasting back.

### 4.4 Runtime: serving dynamic dashboards

Mounted at boot **only when enabled** (`dynamic_dashboards.enabled: true` in
`dashica_config.yaml`), e.g. via `d.EnableDynamicDashboards()`:

- `GET /-/dyn/{slug}` — render the dashboard: load spec from store, `FromSpec`,
  build the layout templ component, render **per request**. (templ components render
  on demand anyway; nothing about the current rendering requires boot-time setup.
  `DashboardContext.NextWidgetId` is per-request state — widget ids must be assigned
  deterministically from spec order so the page and the query dispatcher agree.)
- `GET /-/dyn/{slug}/api/{widgetId}/query` and `/debug` — dynamic dispatcher: load
  spec, rebuild the widget's `SqlQueryable`, delegate to the existing
  `httpserver.QueryHandler`. Identical behavior to compiled widgets, including
  time-range resolution, `AdjustBuckets`, `{{DASHICA_FILTERS}}`.
- `POST /-/api/preview/query` — same as above but the spec comes from the request
  body instead of the store. Powers live preview in the editor **without saving**.
- CRUD: `GET/PUT/DELETE /-/api/dashboards/{slug}`, `GET /-/api/dashboards`.
- `GET /-/api/schema/widgets` — JSON Schema of all registered widget types
  (reflection over spec structs, with `ui:` tags for hints), consumed by the editor.
- `GET /-/api/gocode/{slug}` / `POST /-/api/gocode` — generated Go code (Phase 3).

Everything reuses one prefix registration on the existing `handler_collector`, so the
"no route collisions" validation for compiled dashboards is untouched. The `/-/`
prefix is reserved and rejected in `RegisterDashboard`.

**Menu integration:** the sidebar is rendered per request from
`DashboardContext.MainMenu`. The dynamic dispatcher appends a "Dynamic" `MenuGroup`
(from the store) to the copy it hands to the renderer — no mutation of the shared
boot-time slice, no locking headaches. Compiled pages can get the same via a small
hook in the layout rendering path (Phase 2 decides whether that's worth it or whether
dynamic dashboards are only listed on their own index page at first).

### 4.5 Persistence

```go
type Store interface {
    List(ctx) ([]DashboardMeta, error)
    Get(ctx, slug string) (DashboardSpec, error)
    Put(ctx, slug string, spec DashboardSpec) error
    Delete(ctx, slug string) error
}
```

**Default implementation: a directory of JSON files** (`dynamic_dashboards.dir`,
default `./dynamic_dashboards/`). Rationale:

- Git-friendly — teams can commit dynamic dashboards, review diffs, and sync them
  across environments *even before* graduating them to Go code.
- No new infrastructure; works in local dev instantly.
- Atomic-enough via write-to-temp + rename.

A ClickHouse-backed store (the dependency exists already, cf. alert result storage)
can be added later for multi-replica deployments; the interface keeps that cheap.

### 4.6 Go code generation (the "graduate to code" path)

Package `lib/dashboard/gocode`: `Generate(spec DashboardSpec) (string, error)`.

- Generic, reflection-driven emitter: for each widget, emit the registry's
  constructor (`widget.NewTimeBar(<query expr>)`), then one chained builder call per
  non-zero props field (`.Title("...")`, `.Height(250)`, ...). Field-name → method-name
  is the identity mapping (already true today); exceptions declared via struct tag
  (`gocode:"StackOptions"`).
- Small per-type value emitters: `FieldSpec` → `sql.AutoBucket("timestamp")` /
  `sql.Count().WithAlias("logs")` / ..., `QuerySpec` → `sql.New(sql.From("full_logs"),
  sql.Where("..."))` or `sql.FromFile("...")`, `ColorSpec` → `color.ColorMapping(...)`
  options list.
- Output is run through `go/format`; tests keep golden files for the example
  dashboards **and** compile a package containing generated code in CI (the
  dev-server module is a natural home), which is the only reliable way to guarantee
  the generated API calls actually exist.
- Round-trip test: `Generate(spec)` → (compiled in test fixture) → `.Spec()` equals
  the original spec, for a representative corpus.

The editor shows this code in a "Go code" tab with a copy button — satisfying the
source-of-truth requirement without any Go parsing/interpretation.

### 4.7 Editing existing (compiled) dashboards

Because every dashboard can now report `Spec()`:

1. Each compiled dashboard page gets (behind the same config flag) an "Open in
   editor" action.
2. The server serializes the *registered* dashboard (with whatever parameters it was
   compiled with — templates arrive flattened) and creates a **draft copy** in the
   dynamic store, e.g. slug `p_wetell-overview-draft-1`.
3. The user edits the draft like any dynamic dashboard, with live preview.
4. Outcomes: keep it as a dynamic dashboard, or copy the generated Go code back into
   the repo and delete the draft.

Deliberately **no in-place override** of compiled dashboards at their original URL:
override precedence, cache invalidation and "why does prod differ from the repo?"
confusion outweigh the convenience. Draft-copy semantics keep the mental model
simple: *compiled = immutable truth; dynamic = drafts and experiments.*

### 4.8 Editor UI

Stays on the existing stack (templ + Alpine.js + esbuild + Tailwind/daisyUI) — no
SPA framework. Two-pane editor page at `/-/edit/{slug}`:

- **v1 (Phase 4): spec editor.** Left: a JSON (or YAML) editor of the
  `DashboardSpec` — CodeMirror with JSON-Schema-driven validation and completion
  (schema from `/-/api/schema/widgets`; column-name completions from the existing
  schema introspection endpoint). Right: live preview (debounced `POST
  /-/api/preview/query` per widget, rendered by the *existing* `chart` Alpine
  component — it already takes chartType + props + a query URL) and a "Go code" tab.
  This is a small amount of genuinely new UI code, yet fully functional: build,
  preview, save, export.
- **v2 (Phase 6, optional): structured forms.** Property panel generated from the
  same JSON Schema (widget type dropdown from the registry, field pickers backed by
  schema introspection, color mapping editor, grid-area editor). Purely additive on
  top of the same endpoints; the JSON view stays as the power-user mode.

Starting with the spec editor keeps Phase 4 small and — crucially — means **zero
per-widget UI code**: new widget options appear in the editor automatically via the
generated schema.

## 5. Maintenance cost summary (requirement 2)

| Change | Work needed | Dynamic layer picks it up |
|---|---|---|
| New option on existing widget | 1 spec-struct field + 1 builder method (~5 lines) | JSON, editor schema/completion, preview, codegen: **automatic** |
| New widget type | Spec struct + `FromSpec` + registry entry (+ frontend renderer, needed today anyway) | everything else automatic |
| New `sql` field constructor | New `FieldSpec.Kind` + constructor + codegen emitter case (~15 lines) | automatic |
| New layout | 1 registry entry | automatic |

The enforced `FromSpec(Spec()) ≡` round-trip tests turn "forgot to wire an option
into the dynamic layer" from a silent drift into a failing test.

## 6. Security considerations

- **No expansion of the DB threat model:** dynamic specs contain SQL fragments, which
  the UI can already inject today via the search bar. The real boundary remains the
  ClickHouse user's permissions (read-only user strongly recommended; document this).
- **No code execution:** specs are data. This is the decisive advantage over the
  interpreter approach.
- **Feature is opt-in** (`dynamic_dashboards.enabled`), and a separate
  `dynamic_dashboards.read_only: true` mode serves stored dynamic dashboards but
  rejects writes (for prod, where drafts are made elsewhere and committed as files).
- **Stored content in shared pages:** the markdown widget renders user-authored
  markdown to all viewers. Verify/ensure HTML sanitization in the markdown pipeline
  during Phase 2 (currently only compiled-in, trusted markdown exists; stored specs
  change that). Chart props are attribute-escaped by templ already.
- Dashica's authn/authz story (typically SSO in front) is unchanged; anyone allowed
  into Dashica can use the editor when enabled. Per-user permissions are out of scope.

## 7. Explicitly out of scope (for now)

- Editing alert definitions (alerts.yaml pipeline stays as is).
- Per-user auth / ownership of dynamic dashboards.
- In-place overriding of compiled dashboards (see 4.7).
- Multi-replica write coordination (file store + read_only covers prod initially).
- A drag-and-drop WYSIWYG layout designer (grid editing starts as spec/form based).
- Embedded Go interpreter (documented as rejected, revisit only with a concrete need).

## 8. Implementation phases

Each phase is independently shippable and testable; stop/reassess after any of them.

**Phase 1 — Spec foundation (pure Go, no HTTP, no UI).**
Spec types; refactor widgets to internal props structs (builder API unchanged);
`FromSpec` / `Spec()`; widget + layout registries; `sql.FromString`; `QuerySpec`
extraction from `SqlQuery`/`SqlFile`.
*Tests:* per-widget equivalence (builder-built vs. spec-built → identical chartProps
JSON + SQL); round-trip `FromSpec(Spec())` over the dev-server example dashboards.
*Risk focus:* this is where the "one source of truth" claim is proven or broken.

**Phase 2 — Runtime serving.**
Store interface + file store; `/-/dyn/{slug}` request-time rendering; dynamic
query/debug dispatcher reusing `QueryHandler`; preview endpoint; CRUD API; config
flags; deterministic widget ids; markdown sanitization check.
*Tests:* e2e against the dev-server (`docs/dev-server`): PUT a spec, render the page,
query a widget, compare with the equivalent compiled dashboard's output.

**Phase 3 — Go code generation.**
`gocode.Generate`; golden tests; CI compile-check of generated corpus; `gocode`
endpoints.

**Phase 4 — Editor UI v1 (spec editor + live preview).**
Editor page (templ/Alpine + CodeMirror); JSON-Schema endpoint (reflection over spec
structs); live preview wiring through the existing `chart` component; save/load;
Go-code tab; dynamic dashboards index page + menu group.
*Tests:* browser e2e (Playwright/Chrome MCP per CLAUDE.md): create widget, see
preview, save, reload, export code.

**Phase 5 — Adjust existing dashboards.**
`Spec()` exposed through `Dashica`/dashboard registration; "Open in editor" →
draft-copy flow; documentation of the flattening caveat.

**Phase 6 (optional) — Structured form UI.**
Schema-driven property panels, field/column pickers, color mapping editor,
grid-area editor.

## 9. Open questions (input wanted before Phase 1)

1. **Storage format:** JSON (exact wire format) vs. YAML (nicer to hand-edit/commit)?
   Proposal: JSON on the wire and in the store; revisit YAML only if hand-editing
   becomes common.
2. **Widget scope v1:** is the list in 4.2 right? Are alert widgets needed early?
3. **Menu placement:** should dynamic dashboards appear in the main sidebar of
   compiled pages too, or only under a `/-/dyn/` index page initially?
4. **`FieldSpec` as canonical `SqlField` implementation** (deleting `fieldImpl` /
   `autoBucketFieldImpl`): do the simplification in Phase 1, or keep the refactor
   minimal first?
5. **read_only default for prod configs:** should the sandstorm/solarwatt production
   configs ship with the editor disabled and only committed spec files served?
    