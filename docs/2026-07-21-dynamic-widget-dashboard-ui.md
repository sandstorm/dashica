# Explore View — Dynamic Widget & Dashboard Builder — Design Plan

**Date:** 2026-07-21
**Status:** DRAFT — plan only, nothing implemented yet

## 1. Goal

Add an **optional Explore view** to Dashica: an on-demand query/widget builder UI
(think "Grafana Explore", but producing Dashica widgets), which can grow a whole
dashboard, live at runtime, without recompiling the Go binary.

Hard requirements:

1. **Go stays the source of truth.** The Explore view continuously shows the
   **generated Go code** (existing fluent builder API) for whatever is currently
   being built, so people can copy/paste it into the repository and "graduate" it to
   a compiled dashboard.
2. **Maintenance cost must stay low.** New widgets and new options on existing
   widgets must not require hand-maintaining parallel definitions (schema + form +
   parser + code generator). One definition; everything else derived.
3. **Adjusting existing, compiled dashboards:** open a Go-defined dashboard in
   Explore, tweak it with live preview, export the adjusted Go code.
4. **Persistence is optional.** Without a store, Explore is a pure on-demand
   builder (state lives in the browser). With a store, built dashboards can be
   saved and served like normal dashboards.
5. **Everything is wired up explicitly in `main.go`** — enabling Explore at all,
   and enabling persistence — using the same registration style as dashboards
   today. No hidden config magic:

   ```go
   // main.go — Explore OFF: simply don't register it.
   d := dashica.New(projectFS)
   registerDashboards(d)

   // Explore ON, without persistence (pure on-demand builder):
   d.RegisterDashboardGroup("Explore").
       RegisterDashboard("/explore", explore.New())

   // Explore ON, with persistence:
   d.RegisterDashboardGroup("Explore").
       RegisterDashboard("/explore", explore.New(
           explore.WithFileStore("./dynamic_dashboards"),
       ))
   ```

   `explore.New()` returns a `dashboard.Dashboard` implementation, so it plugs into
   the existing `RegisterDashboard` mechanism unchanged (its `CollectHandlers`
   registers the editor page plus its API sub-routes; `net/http`'s trailing-slash
   subtree matching gives us request-time dispatch under `/explore/`).
6. **New code lives in `lib/explore/`** — except for the (deliberately small) core
   adjustments to `lib/dashboard/...` described in 4.1.

## 2. Relevant facts about the current architecture

These facts are what make the design below cheap:

- **The frontend is already fully data-driven.** Every chart widget renders via
  `widget_component.Chart(widgetBaseUrl, chartType, chartPropsJSON, height)`
  (`lib/components/widget_component/chart.templ`). The Alpine.js `chart` component
  (`frontend/components/chart.ts`) picks a renderer from a `charts = {timeBar,
  timeLine, barVertical, ...}` map, fetches data from `<widgetBaseUrl>/query`, and
  renders. The browser never sees Go — it sees **(chartType, chartProps JSON, a
  query URL)**. The Explore preview can reuse this component as-is.
- **A Go widget is a thin, typed factory for exactly three artifacts:**
    1. `chartProps` JSON (e.g. `TimeBar.buildChartProps()` in
       `lib/dashboard/widget/time_bar.go`),
    2. an `sql.SqlQueryable` (built in `buildQuery()` from the base query plus the
       X/Y/Fill/... fields),
    3. HTTP handlers `<id>/query` + `<id>/debug` via the shared
       `RegisterQueryHandlers` (`lib/dashboard/widget/widget_common.go`).
- **Queries are already structured data.** `sql.SqlQuery` holds `selectF / from /
  where / groupBy / ...` as plain fields; field constructors (`sql.AutoBucket`,
  `sql.Count`, `sql.Enum`, ...) produce small `{definition, alias, xBucketSizeMs,
  column}` structs.
- **Filters arrive at request time anyway.** `httpserver.QueryHandler.HandleQuery`
  applies time range + search-bar filter per request — a widget's query object is a
  *template*, already re-evaluated per request. Executing a widget that arrived as
  JSON in a POST body is the same code path.
- **The search bar already sends raw SQL from the browser** (`sqlFilter` → `WHERE`
  clause). Anyone who can reach the Dashica UI can already run arbitrary SQL with
  the ClickHouse user's permissions. Explore does not materially expand the
  database threat model.
- **Schema introspection exists** (`lib/clickhouse/introspect_schema.go`,
  `frontend/util/schema.ts`) and **value sampling infrastructure exists**
  (`lib/db_sampler`) — the raw material for column pickers and autocomplete.

**Consequence:** the missing piece is not a new rendering stack. It is
(a) making the existing model **serializable**, (b) a small runtime in
`lib/explore` that executes a JSON-described widget, (c) a code generator back to
builder calls, and (d) the editor UI.

## 3. Options considered

### Option A — Embedded Go interpreter (yaegi or similar)

Store dashboards as Go source, interpret at runtime.

Rejected, decisively:

- **Security regression:** UI-triggered arbitrary Go = RCE by design (filesystem,
  network, `os/exec`) — a categorically bigger blast radius than today's
  "UI can send SQL" model. Sandboxing yaegi symbol tables is fiddly and fragile.
- **A form-based builder still needs a structured model.** Editing Go *text* from
  forms means AST round-tripping arbitrary Go — harder than everything else in this
  plan combined.
- yaegi lags Go releases, inflates the binary, needs maintained symbol exports.
- Does not help adjusting *compiled* dashboards (no interpretable source in the
  binary).

### Option B — Hand-written parallel JSON schema + parser + forms + codegen

Rejected — violates requirement 2; four to five hand-synced definition places per
widget option would drift within months.

### Option C — Derive everything from the existing structs (chosen)

**No parallel "spec" model — and no restructuring either.** The existing widget /
query / field structs *are* the model. A `go:generate` tool parses them (AST +
doc comments) and emits, per package, the serializers, an editor descriptor
(including the doc comments as help texts), and code-generation tables — see 4.1.
The structs stay byte-for-byte as they are today, unexported fields and all. A
thin JSON envelope exists only where `encoding/json` fundamentally cannot work
(interface-typed fields need a type discriminator; function values need a name
registry). Everything derives from the one existing struct: JSON wire format,
editor form model, Go-code generation, and export of compiled dashboards.

### Option D — Frontend-only Go-snippet generator

No server execution, no live preview, no editing of existing dashboards. Rejected
as the main approach; its codegen part is Phase 3 of the chosen plan.

## 4. Architecture

### 4.1 Core model adjustments (`lib/dashboard/...`, `lib/dashboard/sql`)

**Principle: derive from the given structs — do not build a parallel tree, do not
restructure.** A separate `DashboardSpec`/`WidgetSpec`/... hierarchy was considered
and dropped (would duplicate every widget's fields and drift); so was restructuring
widgets around an exported `Opts` struct + runtime reflection (grows the public API,
churns every widget, and loses doc comments). Instead, a **`go:generate` tool**
reads the existing structs and emits everything derived. Only two kinds of
indirection are unavoidable, and both are thin:

| Problem                                                                                | Why plain serialization is impossible                               | Solution                                                                                           |
|----------------------------------------------------------------------------------------|---------------------------------------------------------------------|----------------------------------------------------------------------------------------------------|
| Interface-typed fields (`widget.WidgetDefinition`, `sql.SqlQueryable`, `sql.SqlField`) | `encoding/json` cannot decide which concrete type to unmarshal into | A small tagged-union **envelope** (`{"type": "timeBar", ...}`) resolved via a registry             |
| Function-typed fields (`rendering.LayoutFunc`)                                         | Functions are not data                                              | Layouts become **named** (`layout.Layout{Name, Fn}`); JSON stores the name, a registry resolves it |

Concrete adjustments, per package:

**(1) Widgets: keep the structs exactly as they are; a `go:generate` tool derives
everything.**

Widget structs today are loose unexported fields with doc comments, e.g.:

```go
type TimeBar struct {
    sql    sql.SqlQueryable
    x      sql.TimestampedField
    y      sql.SqlField
    fill   *sql.SqlField
    title  string
    height int
    // ... ~10 more
}
```

They stay **byte-for-byte unchanged** — private fields, private types, no `Opts`
grouping, no JSON tags, no new exported API. A new generator (`cmd/dashica-gen`,
built on `go/packages` + `go/ast` + `go/doc`, invoked via `//go:generate` in the
widget package) parses each registered widget struct **including its field types
and doc comments** and emits a sibling `zz_generated.dashica.go` **in the same
package** — which is the trick that makes "private" work: generated code has full
access to unexported fields, so no accessor, no exported options struct, and no
runtime reflection are needed. Per widget it emits:

1. **`MarshalJSON` / `UnmarshalJSON`** reading/writing the unexported fields
   directly. Interface-typed fields delegate to the `sql` serializers from (2)
   and the widget envelope from (3). JSON property name = field name
   (normalizations like `sql` → `"query"` via a struct tag on the unexported
   field — legal Go, readable by the AST parser even though `encoding/json`
   ignores unexported fields).
2. **An editor descriptor** (data consumed by `/explore/api/formmodel`, 4.4):
   field order, editor kind **inferred from the Go type** (`sql.TimestampedField`
   → field picker in timestamped mode, `*sql.SqlField` → optional field picker,
   `string`/`int`/`bool` → primitives, `color.ColorScale` → colorScale control,
   `StackOptions` → its own group with select options read from the package-level
   `Order*`/`Offset*` vars), and — the payoff of parsing source instead of
   reflecting at runtime — **the existing doc comments as help texts/tooltips**
   in the editor. The extensive comments already written (e.g. on `StackOptions`,
   `StackOrder`, `WithFill`) become user-facing documentation for free.
3. **A code-generation table** for 4.5: field ↔ builder method matched by name
   (`title` → `.Title(...)`), **verified at generation time** — the generator
   errors out if a field has no matching builder method and no override
   (`//dashica:gocode method=StackOptions` or `//dashica:gocode skip` on e.g.
   internal-only fields like `id`).

Defaults (e.g. `height: 200` set in `NewTimeBar`) are not parsed from source —
the registry's factory (3) constructs a zero-value widget at startup and
marshals it; whatever it contains *is* the default set. Accurate by definition.

Guard rails:
- The generator **fails loudly** on field types outside its supported set
  (primitives, pointers, maps, `sql` interfaces, `color.ColorScale`,
  nested-widget maps, ...) — a new *type* of option is a conscious extension
  (add a serializer case + an editor kind), never silent drift.
- CI runs `go generate ./...` and fails on `git diff --exit-code` — generated
  files can never go stale.

`StackOrder`/`StackOffset` keep their unexported-field enum trick; the generator
emits their (de)serializers validating against the known values.
`color.ColorScale` is already plain data; serializer generated the same way.

Chosen over the two alternatives for open-question-4 reasons:
runtime reflection would require *exported* options structs (bigger public API,
every widget restructured) and cannot see doc comments; hand-written serializers
per widget would be requirement-2 drift. Cost of the generator: a one-time
~500–1000-line tool plus a build step — concentrated, testable, and paid once.
(Fallback if the generator stalls in practice: the exported-`Opts` +
runtime-reflection design remains viable plan B; the wire format would be
identical.)

**(2) `sql`: keep the type structure as-is; add (de)serializers.**

The `sql` package's types (`fieldImpl`, `autoBucketFieldImpl`, `SqlQuery`,
`SqlFile`, all with unexported fields) stay **structurally untouched** — no field
unification, no exporting of internals. Serialization is added *around* them:

- Each concrete type gets `MarshalJSON`/`UnmarshalJSON` (methods can read the
  unexported fields), implemented against small private DTO structs in one
  `serialization.go` inside the package. Wire format is the tagged form shown in
  the example below (`{"kind": "autoBucket", "column": ...}`).
- Hand-written serializers here are a deliberate exception to the
  "derive everything" rule — and an acceptable one: the `sql` vocabulary is small
  and stable (a handful of field kinds, three queryables), unlike the growing
  widget surface. The round-trip tests in (5) still catch any drift. Note that
  reflection would buy little in this package anyway: the editor and the code
  generator treat fields/queries via *dedicated* handling (the `field` and `query`
  editor kinds in 4.4, per-kind emitters in 4.5), not via generic struct walking.
- One tiny internal addition: constructors stamp an unexported `kind`
  (`sql.Count()` → `"count"`, `sql.Enum(...)` → `"enum"`, ...). Without it,
  semantic constructors would serialize as their baked raw expression
  (`{"kind": "expr", "definition": "count(*)"}`) — still round-trip-safe, but the
  code generator could then only emit `sql.Field("count(*)")` instead of the
  idiomatic `sql.Count()`, and the editor could only show "custom expression".
  A few bytes per field buy idiomatic codegen and better forms.
- For **interface-typed fields in widget structs**, the package exports two pairs
  of helper functions that the generated widget serializers (see (1)) call:

```go
// Marshal delegates to the concrete impl; Unmarshal dispatches on "kind"
// to the right constructor.
func MarshalField(f SqlField) ([]byte, error)
func UnmarshalField(b []byte) (SqlField, error)

// Same for SqlQueryable ("table" | "file" | "raw" envelope).
func MarshalQueryable(q SqlQueryable) ([]byte, error)
func UnmarshalQueryable(b []byte) (SqlQueryable, error)
```

Builder method signatures and widget fields keep the plain interfaces — zero API
change for dashboard authors.

New third `SqlQueryable` implementation for the Explore UI (also useful for
compiled dashboards):

```go
// sql.FromString: like SqlFile but with inline SQL content. Same
// {{DASHICA_FILTERS}} enforcement; needed because Explore cannot write files
// into the embedded projectFS.
func FromString(content string) *SqlString
```

The `SqlQueryable` interface gets marshalled via a tagged envelope:

```json
{
  "kind": "table",
  "table": "full_logs",
  "where": [
    "level = 'error'"
  ]
}
{
  "kind": "file",
  "path": "src/p_wetell/overview.sql",
  "where": []
}
{
  "kind": "raw",
  "sql": "SELECT ... WHERE {{DASHICA_FILTERS}} ..."
}
```

**(3) Widget envelope + registry.** `widget.Widgets` (the slice) gets
`MarshalJSON`/`UnmarshalJSON` using a registry — the *only* per-widget
registration needed:

```go
// lib/dashboard/widget/registry.go
func init() { // or explicit RegisterWidgetType calls
Register("timeBar", func () WidgetDefinition { return NewTimeBar(nil) })
Register("table", func () WidgetDefinition { return NewTable(nil) })
// ...
}

// Wire format of one widget:
// {"type": "timeBar", "props": { ...generated per-widget JSON... },
//  "children": {"a": {...}, "b": {...}}}   // grid / group widgets only
```

Unmarshal: look up factory by `type`, delegate `props` to the widget's generated
`UnmarshalJSON` (strict decoding — unknown fields are errors, catching typos),
recurse into `children`. Marshal: reverse lookup by `reflect.Type`, delegate to
the generated `MarshalJSON`. The registry also feeds the generator (which structs
to process) and the default extraction described in (1).

**(4) Dashboard + layout.** `dashboardImpl`'s fields (`title`, `searchBar`,
`widgets`, `layout`) become serializable the same way. `WithLayout` changes to
accept a named layout:

```go
// lib/components/layout
var DefaultPage = layout.Layout{Name: "defaultPage", Fn: defaultPageFn}
```

(Existing call sites `WithLayout(layout.DefaultPage)` stay identical in source.)
JSON stores `"layout": "defaultPage"`; a registry resolves the function.

**(5) Round-trip invariant, enforced by tests:** for every example dashboard,
`unmarshal(marshal(d))` produces identical chartProps JSON and identical built SQL.
This test is what turns "forgot to make an option serializable" from silent drift
into a red build.

**Example — full round trip for one widget.** Compiled Go (from
`templates.LogOverview`):

```go
widget.NewTimeBar(sql.New(sql.From("full_logs"),
sql.Where("level = 'error' OR level = 'fatal'"))).
Title("Error / Fatal Logs").
Height(150).
X(sql.AutoBucket("timestamp")).
Y(sql.Count().WithAlias("logs")).
Fill(sql.Enum("level")).
Color(color.ColorLegend(true), color.ColorMapping("error", "#E74C3C"))
```

Serializes to (and deserializes from):

```json
{
  "type": "timeBar",
  "props": {
    "query": {
      "kind": "table",
      "table": "full_logs",
      "where": [
        "level = 'error' OR level = 'fatal'"
      ]
    },
    "x": {
      "kind": "autoBucket",
      "column": "timestamp",
      "alias": "time"
    },
    "y": {
      "kind": "count",
      "alias": "logs"
    },
    "fill": {
      "kind": "enum",
      "column": "level"
    },
    "title": "Error / Fatal Logs",
    "height": 150,
    "color": {
      "legend": true,
      "mappings": {
        "error": "#E74C3C"
      }
    }
  }
}
```

…and the code generator (4.5) emits exactly the Go snippet above again.

### 4.2 Package layout

```
cmd/dashica-gen/      // the go:generate tool from 4.1 (go/packages + go/ast + go/doc)
lib/dashboard/widget/
    zz_generated.dashica.go  // generated: serializers, editor descriptors, gocode tables
lib/explore/
    explore.go        // New(...Option), implements dashboard.Dashboard
    handlers.go       // editor page + API routes (see 4.3)
    formmodel.go      // serves the generated editor descriptors as form model JSON
    gocode.go         // JSON widget/dashboard -> Go source (see 4.5)
    store.go          // Store interface + file store (optional persistence, 4.7)
    values.go         // distinct-value sampling for autocomplete (via db_sampler)
frontend/explore/
    editor.ts         // editor state + wiring
    formRenderer.ts   // generic form renderer (one control per editor kind, 4.6)
    controls/*.ts     // field picker, colorScale editor, whereList, gridDesigner...
```

Core adjustments (4.1) plus `cmd/dashica-gen` and its generated files are the only
changes outside `lib/explore` / `frontend/explore`.

### 4.3 HTTP API (all under the registration URL, e.g. `/explore`)

| Route                                | Method         | Purpose                                                                                                                                                                                                                                                                    |
|--------------------------------------|----------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `/explore`                           | GET            | Editor UI page (templ-rendered, like any dashboard)                                                                                                                                                                                                                        |
| `/explore/api/preview/query`         | POST           | Body: one widget JSON (+ the usual `filters`/`params` query args). Deserializes, builds the query, delegates to the existing `httpserver.QueryHandler`. Same response format/headers as compiled widgets → the existing `chart` frontend component consumes it unmodified. |
| `/explore/api/preview/debug`         | POST           | Same, but `HandleDebug` (SQL + EXPLAIN) — powers the debug drawer in the preview                                                                                                                                                                                           |
| `/explore/api/gocode`                | POST           | Body: dashboard JSON → generated Go source (string)                                                                                                                                                                                                                        |
| `/explore/api/formmodel`             | GET            | Form models for all registered widget types + layouts (4.6)                                                                                                                                                                                                                |
| `/explore/api/schema`                | GET            | Tables + columns + types (existing introspection)                                                                                                                                                                                                                          |
| `/explore/api/values?table=&column=` | GET            | Top distinct values for a column (autocomplete for enum/color mappings; `LIMIT`ed, time-bounded)                                                                                                                                                                           |
| with persistence only (4.7):         |                |                                                                                                                                                                                                                                                                            |
| `/explore/api/dashboards`            | GET            | List saved dynamic dashboards                                                                                                                                                                                                                                              |
| `/explore/api/dashboards/{slug}`     | GET/PUT/DELETE | CRUD                                                                                                                                                                                                                                                                       |
| `/explore/d/{slug}`                  | GET            | Render a saved dynamic dashboard (request-time: load JSON → unmarshal → render layout; widget query URLs point at `/explore/d/{slug}/api/{widgetId}/query`, dispatched the same way)                                                                                       |

Preview request example:

```
POST /explore/api/preview/query?filters={"timeRange":"24h"}
{ "type": "timeBar", "props": { ... } }
→ 200, Arrow stream + X-Dashica-Resolved-Time-Range / X-Dashica-Bucket-Size
   (identical to a compiled widget's /query endpoint)
```

Widget ids inside a dynamic dashboard are assigned deterministically from tree
position (index path), so page render and query dispatch agree without shared
state.

### 4.4 Editor UI — structured forms (the core of the UX)

A JSON textarea is not practical for the target users; **structured forms are the
primary editing surface** (a raw JSON tab remains as power-user escape hatch).
The build approach, concretely:

**Server side — form model from the generated descriptors, zero per-widget UI
code.** `formmodel.go` serves the editor descriptors that `dashica-gen` emitted
(4.1): field order, labels, editor kind (inferred from the Go field type),
defaults (extracted from factory instances), **and the widgets' Go doc comments
as help texts** — shown as tooltips/help in the editor:

```json
// GET /explore/api/formmodel  (excerpt for timeBar)
{
  "timeBar": {
    "title": "Time Bar",
    "hasQuery": true,
    "fields": [
      {
        "name": "x",
        "editor": "field",
        "required": true,
        "timestamped": true
      },
      {
        "name": "y",
        "editor": "field",
        "required": true
      },
      {
        "name": "fill",
        "editor": "field"
      },
      {
        "name": "title",
        "editor": "text"
      },
      {
        "name": "height",
        "editor": "int",
        "default": 200
      },
      {
        "name": "color",
        "editor": "colorScale"
      },
      {
        "name": "stack",
        "help": "Groups the Observable Plot stack transform options for the fill series (offset, order, reverse). ...",
        "editor": "group",
        "fields": [
          {
            "name": "order",
            "editor": "select",
            "options": [
              "value",
              "sum",
              "appearance",
              "inside-out"
            ]
          },
          {
            "name": "offset",
            "editor": "select",
            "options": [
              "expand",
              "center",
              "wiggle"
            ]
          },
          {
            "name": "reverse",
            "editor": "bool"
          }
        ]
      }
    ]
  }
}
```

Because the form model is derived from the same parsed struct as the JSON wire
format and the codegen, **a new widget option appears in the editor automatically**.

**Client side — one generic renderer + a small fixed set of controls.**
`formRenderer.ts` walks the form model and instantiates one control per editor
kind. The kinds are finite and stable (~10); new *options* never need UI work, only
a genuinely new *type of value* would:

| Editor kind                     | Control                                                                                                                | Autocomplete source                                                                                                                    |
|---------------------------------|------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------|
| `text`, `int`, `bool`, `select` | native inputs                                                                                                          | —                                                                                                                                      |
| `field`                         | composite: kind dropdown (column / autoBucket / count / enum / custom expression) + column combobox + alias input      | `/api/schema` columns of the chosen table; `timestamped: true` filters to DateTime columns                                             |
| `query`                         | base-query section: source toggle (table / .sql file / raw SQL) + table combobox + where-clause list + database select | tables from `/api/schema`; `.sql` files listed from projectFS                                                                          |
| `whereClause`                   | CodeMirror (SQL mode, single line)                                                                                     | column names from schema; operator/function snippets; "validate" runs `/preview/debug` (EXPLAIN) and surfaces ClickHouse errors inline |
| `rawSql`                        | CodeMirror (SQL mode, multiline)                                                                                       | same; enforces `{{DASHICA_FILTERS}}` presence client-side before preview                                                               |
| `colorScale`                    | row list: value → color picker (+ legend toggle, unknown color)                                                        | value suggestions from `/api/values?table&column` for the current fill/enum column                                                     |
| `keyValue` (tipChannels)        | row list of two text inputs                                                                                            | column names                                                                                                                           |
| `children` (grid/groups)        | handled by the tree + grid designer (4.8), not a form control                                                          | —                                                                                                                                      |

**Handcode the renderer, or use an existing library?** Short evaluation of the
open-source landscape (as of 2026-07):

| Candidate | Verdict |
|---|---|
| [JSONForms](https://jsonforms.io/docs/renderer-sets) | Schema-driven, mature — but every renderer set requires React, Vue or Angular (the ["vanilla" renderers](https://www.npmjs.com/package/@jsonforms/vanilla-renderers) are *React* renderers emitting plain HTML). Pulling a SPA framework into an Alpine/templ codebase for one panel: no. |
| react-jsonschema-form, SurveyJS, Formily | Same framework mismatch (React/Vue), plus survey-oriented scope. |
| [json-editor/json-editor](https://github.com/json-editor/json-editor) | The one real framework-free option: vanilla JS, JSON-Schema-driven, custom-editor resolver API, still maintained. But: its value is the ~6 primitive editors (text/number/bool/select/array) — trivial to write; our *actual* work is the custom controls (field picker, query section, whereClause, colorScale), which would have to be written as json-editor plugins anyway, against its schema-resolver API and its own theming layer (fights Tailwind/daisyUI). Net saving ≈ zero, plus a dependency with its own opinions. |
| [jsfe](https://github.com/json-schema-form-element/jsfe) (web component) | Young, web-component-based, same custom-control problem. |
| Tweakpane / lil-gui | Great for flat debug panels; wrong look and too limited for composite controls. |

**Decision: handcode `formRenderer.ts`.** The generic part (walk form model,
dispatch to control, read/write the JSON state, show validation) is ~200–300 lines;
the custom controls dominate the effort *in every scenario* and are unavoidable.
A library would only replace the cheap 20 % while constraining the expensive 80 %.

**CodeMirror — used for exactly one thing:** the three SQL-ish text inputs
(`whereClause`, `rawSql`, the "custom expression" mode of the field picker). There
it earns its place: SQL syntax highlighting, autocompletion popup fed by our schema
endpoint (columns, tables, ClickHouse functions), and inline error squiggles from
the EXPLAIN validation. It is **not** used for forms, JSON, or the Go-code view
(the Go tab is read-only — `<pre>` + copy button suffices; highlight.js optional).
If we want to cut the dependency initially, fallback is `<input>` + `<datalist>`
for column completion — workable for `whereClause`, too weak for `rawSql`; decide
in Phase 4. Everything else is plain TypeScript + Alpine, matching the existing
stack — no React/SPA.

**Page layout — Neos CMS editing model** (tree left, *the page itself* in the
middle, inspector right):

```
┌ toolbar: dashboard title · layout · [Save*] [Share link] ──────────────────┐
├────────────┬──────────────────────────────────────────┬────────────────────┤
│ widget     │ FULL DASHBOARD PREVIEW                   │ inspector          │
│ tree       │ (the real page: chosen layout + all      │ (form-model-driven │
│            │  widgets, rendered by the existing       │  form for the      │
│ add widget │  `chart` component against /api/preview; │  SELECTED widget:  │
│ (registry  │  debounced ~400ms re-query on edits)     │  query section on  │
│ dropdown), │                                          │  top, then widget  │
│ reorder,   │ click a widget in the preview to select  │  options)          │
│ duplicate, │ it (hover outline + selection border,    │                    │
│ nest into  │ like Neos content selection); selection  │ dashboard-level    │
│ grid areas │ syncs with the tree                      │ settings when      │
│            │                                          │ nothing selected   │
├────────────┴──────────────────────────────────────────┴────────────────────┤
│ bottom drawer (collapsible): [Go code] [JSON] [SQL/debug of selection]     │
└─────────────────────────────────────────────────────────────────────────────┘
* Save only shown when persistence is configured
```

Rationale for the choices inside this model:
- **Preview shows the whole dashboard, not just the selected widget.** Widgets are
  judged in context (grid neighbors, heights, shared time axis), and the preview
  doubles as the click-to-select surface — same reason Neos renders the real page.
  A "solo" toggle on the selected widget (temporarily preview it alone, full-width)
  covers the focused-editing case cheaply.
- **Settings right, not below:** dashboards are vertically long; a bottom panel
  would push the form out of view while scrolling the preview. A fixed right
  inspector (Neos-style) keeps query + options visible next to whatever is
  selected. Go code / JSON / SQL go into a collapsible bottom drawer — they are
  occasional-read surfaces, not constant companions.
- Only the *edited* widget re-queries on change; untouched widgets keep their
  rendered state — cheap because each preview widget is its own `chart` instance
  with its own POST body.

**State without persistence:** the dashboard JSON lives in a client-side store,
autosaved to `localStorage`, and shareable via an `lz-string`-compressed URL
fragment (`/explore#s=...`) — Explore is fully useful as a throwaway query builder
with zero server state.

**Go code preview** is a first-class tab, regenerated on every change (debounced
`POST /api/gocode`), with a copy button — the "graduate to code" path is always one
click away, satisfying requirement 1 continuously rather than as a final export
step.

### 4.5 Go code generation (`lib/explore/gocode.go`)

- Generic emitter driven by the generated code-generation tables (4.1): emit the
  registry constructor (`widget.NewTimeBar(<query expr>)`), then one chained
  builder call per non-default field (`.Title("...")`, `.Height(150)`, ...). Field
  name → method name is the identity mapping (true today), verified by
  `dashica-gen` at generation time; exceptions via `//dashica:gocode` comments.
- Small per-type value emitters: `sql.FieldRef` → `sql.AutoBucket("timestamp")` /
  `sql.Count().WithAlias("logs")` / ...; query envelope → `sql.New(sql.From(...),
  sql.Where(...))` / `sql.FromFile(...)` / `sql.FromString(...)`;
  `color.ColorScale` → `color.New(color.ColorLegend(true), ...)` option list.
- Output through `go/format`. Tests: golden files for the dev-server example
  dashboards **plus a CI compile check** of a package containing generated code
  (the only reliable guarantee that emitted API calls exist), plus round-trip:
  generated code (compiled in the test fixture) marshals back to the original JSON.

### 4.6 Drag-and-drop WYSIWYG grid designer (how to build it)

The `Grid` widget is CSS `grid-template-areas` (`Template("a a b", "c c b")` +
`Area(name, widget)`) — which makes a visual editor tractable, because the model is
just *named rectangles on a cell matrix*:

- **Data model in the editor:** `{cols, rows, areas: [{name, r0, c0, r1, c1}]}`.
  Serialization back to template strings is trivial string assembly; parsing
  existing templates is a scan for each name's bounding box.
  `grid-template-areas` requires areas to be contiguous rectangles — the editor
  *enforces* this by construction (every operation below keeps areas rectangular),
  which is simpler than validating free-form input.
- **Rendering:** the designer is an overlay on the *real* preview — the preview
  grid already is CSS grid, so the overlay is an absolutely-positioned div per
  area plus thin gutter hit-zones, aligned via the same
  `grid-template` (no coordinate math against pixel positions needed; CSS does it).
- **Interactions** (plain pointer events, ~300–400 lines, no library; `interact.js`
  as fallback if edge cases pile up):
    1. *Create area:* rubber-band drag over empty cells → rectangle → prompts for
       widget (or drops a placeholder to fill via the tree/form).
    2. *Resize:* drag an area's edge/corner; snap to cell boundaries; reject overlap.
    3. *Move:* drag area body to a new anchor cell (same rectangle size).
    4. *Rows/cols:* `+`/`−` buttons on the matrix edges.
    5. *Assign:* drag a widget from the tree onto an area, or click-to-assign.
- **Top-level (non-grid) widget order** in a dashboard: simple drag-sort of the
  tree list (SortableJS-sized problem; can also be hand-rolled).

This ships as a later phase (Phase 7); until then grids are edited via the tree
(`children`) + a plain textarea for the template rows — fully functional, just not
visual.

### 4.7 Persistence (optional, explicit in `main.go`)

```go
// lib/explore/store.go
type Store interface {
List(ctx context.Context) ([]Meta, error)
Get(ctx context.Context, slug string) (dashboard.Dashboard, error) // unmarshal
Put(ctx context.Context, slug string, d dashboard.Dashboard) error // marshal
Delete(ctx context.Context, slug string) error
}
```

- Enabled solely by passing an option in `main.go`: `explore.WithFileStore(dir)`
  (default impl: directory of JSON files — git-friendly: dynamic dashboards can be
  committed, diffed, reviewed, and shipped across environments even before being
  rewritten as Go). Write-to-temp + rename for atomicity.
  `explore.WithReadOnly()` serves stored dashboards but rejects writes (prod).
- Without a store: no save button, no `/explore/d/...` routes; nothing else
  changes — Explore remains a stateless on-demand builder.
- A ClickHouse-backed store can be added later behind the same interface
  (multi-replica deployments).

### 4.8 Menu integration

Saved dynamic dashboards appear **in the main sidebar**, alongside compiled ones,
**visually tagged as dynamic** — via a generic tag mechanism rather than a
feature-specific boolean:

- `rendering.MenuGroupEntry` gains `Tags []rendering.Tag` with
  `type Tag struct { Label string; Color string }`, rendered as small pills /
  hashtag-style badges after the entry title in `page_menu.templ` (daisyUI `badge`,
  `Color` as background). Explore contributes `Tag{Label: "dyn", Color: ...}` to
  its entries.
- Generic on purpose: compiled dashboards can use the same mechanism from
  `RegisterDashboard` (e.g. `#staging`, `#experimental`, per-customer tags) — one
  rendering path, no Explore-specific case in the menu template. Exposing a
  `Tag(...)` builder option on `dashboard.Dashboard` for compiled dashboards is a
  cheap follow-up, not required for Explore.
- The sidebar is rendered per request from `DashboardContext.MainMenu`; when
  Explore has a store, it contributes a provider that appends its entries (an
  "Explore" `MenuGroup`, plus per-dashboard entries) to a per-request *copy* of the
  menu — the boot-time slice is never mutated, no locking. Compiled pages get the
  same entries because the provider hooks into the shared menu-build step in
  `rendering`, not into the Explore handler.

### 4.9 Editing existing (compiled) dashboards

Because dashboards/widgets are now directly marshallable:

1. Every compiled dashboard page gets an "Open in Explore" action (only rendered
   when Explore is registered).
2. The server marshals the registered dashboard object to JSON and redirects to
   `/explore` with that JSON as the initial editor state (client-side; **no store
   required** — this works in pure on-demand mode).
3. The user tweaks with live preview, then copies the regenerated Go code back into
   the repo — or, with persistence, saves it as a dynamic dashboard under a new
   slug.

Deliberately **no in-place override** of compiled dashboards at their original URL
(precedence/"why does prod differ from the repo" confusion). Compiled = immutable
truth; dynamic = drafts and experiments.

Known, accepted limitation: exporting a compiled dashboard **flattens
abstractions** — `templates.LogOverview(sql.Where(...))` exports as its expanded
widget list, not as the helper call. Humans re-introduce the helper when pasting
back.

## 5. Maintenance cost summary

| Change                        | Work needed                                                                                                              | Explore picks it up                                 |
|-------------------------------|--------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------|
| New option on existing widget | 1 struct field + 1 builder method (~5 lines, exactly as today) + `go generate` (CI-checked)                               | JSON, form (incl. doc-comment help), preview, codegen, export: **automatic** |
| New widget type               | widget struct + behavior (needed today anyway) + 1 registry line + `go generate` (+ frontend chart renderer, needed today anyway) | everything else automatic                           |
| New `sql` field kind          | constructor + `kind` stamp + serializer case + codegen emitter case (~20 lines)                                           | automatic                                           |
| New layout                    | 1 named-layout registry entry                                                                                            | automatic                                           |
| New *type* of option value    | new form-model editor kind + 1 frontend control                                                                          | rare by design                                      |

The round-trip tests (4.1 (5), 4.5) turn forgotten wiring into failing builds.

## 6. Security considerations

- **No expansion of the DB threat model:** Explore sends SQL fragments from the
  browser — the search bar already does. The real boundary is the ClickHouse user's
  permissions (read-only user strongly recommended; document this).
- **No code execution:** dashboards are data (JSON), never code. This is the
  decisive advantage over the interpreter approach.
- **Opt-in by code:** not registered in `main.go` → no routes exist at all.
  `WithReadOnly()` for prod when only committed JSON files should be served.
- **Stored content shown to other users** (persistence mode): the markdown widget
  renders author-controlled markdown for all viewers — verify/add HTML
  sanitization in the markdown pipeline during Phase 2 (today all markdown is
  compiled-in and trusted; stored dashboards change that). Chart props are
  attribute-escaped by templ already.
- Authn/authz unchanged (Dashica typically sits behind SSO); per-user permissions
  out of scope.

## 7. Explicitly out of scope (for now)

- Editing alert definitions (alerts.yaml pipeline unchanged).
- Per-user ownership/permissions of dynamic dashboards.
- In-place override of compiled dashboards (see 4.9).
- Multi-replica write coordination (file store + `WithReadOnly` covers prod).
- Embedded Go interpreter (rejected; revisit only with concrete need).
- Widget coverage v1: all chart widgets (timeBar, timeLine, barVertical,
  barHorizontal, timeHeatmap, timeHeatmapOrdinal, stats, table) + markdown, grid,
  multiColumn, collapsibleGroup, checkboxGroup, textInput. Alert widgets,
  schemaTable, speedscopeLink follow later (extra dependencies, rarely prototyped).

## 8. Implementation phases

Each phase is independently shippable; stop/reassess after any.

**Phase 1 — `dashica-gen` + core serialization (existing packages untouched in
structure).**
The `cmd/dashica-gen` generator (AST + doc-comment parsing → per-widget
serializers, editor descriptors, gocode tables); hand-written `sql`
(de)serializers + `Marshal/UnmarshalField|Queryable` helpers + constructor `kind`
stamps; `sql.FromString`; envelopes + registries (widgets, queryables, layouts);
named layouts; CI staleness check for generated files.
*Tests:* per-widget equivalence (builder-built vs. JSON-round-tripped → identical
chartProps + SQL) over the dev-server example dashboards; generator golden tests
on a fixture package.
*Risk focus:* this proves or breaks both the single-source-of-truth claim and the
generator approach — do it first. If the generator turns out disproportionate,
fall back to plan B (exported `Opts` + runtime reflection; same wire format)
before any later phase depends on it.

**Phase 2 — `lib/explore` runtime.**
`explore.New()` as `dashboard.Dashboard`; preview query/debug endpoints delegating
to `httpserver.QueryHandler`; formmodel + schema + values endpoints; markdown
sanitization check.
*Tests:* e2e against the dev-server: POST a widget JSON, compare response with the
equivalent compiled widget's endpoint.

**Phase 3 — Go code generation.**
`gocode.go`; golden tests; CI compile check; `/api/gocode`.

**Phase 4 — Editor UI (structured forms + live preview + Go code tab).**
Form renderer + control set (4.4); widget tree; preview wiring through the existing
`chart` component; localStorage/share-link state; JSON power-user tab.
*Tests:* browser e2e (Playwright/Chrome MCP per CLAUDE.md): build a timeBar via
forms, see preview, see generated Go, share-link round-trip.

**Phase 5 — Open existing dashboards in Explore.**
Marshal registered dashboards; "Open in Explore" action; flattening caveat
documented.

**Phase 6 — Optional persistence.**
`Store` + file store + `WithFileStore`/`WithReadOnly`; `/explore/d/{slug}`
rendering + per-widget dispatch; CRUD API; sidebar integration via the generic
`Tags` pill mechanism (`#dyn`).

**Phase 7 — WYSIWYG grid designer (optional).**
Overlay editor per 4.6; tree drag-sort.

## 9. Open questions

1. **Storage format:** JSON (exact wire format) — recommended; YAML only if
   hand-editing stored files becomes common.
2. **`/explore` URL & slug namespace:** `/explore/d/{slug}` as proposed, or a
   separate top-level prefix for saved dynamic dashboards?
3. **Strictness of decode:** unknown JSON fields = hard error (recommended: catches
   typos and stale stored files after renames) vs. tolerated (survives field
   renames without migration)?
4. ~~`Opts` field exposure~~ — **resolved**: the `dashica-gen` approach (4.1) keeps
   all widget fields private and adds no exported options structs; generated code
   in the same package accesses unexported fields directly. Remaining sub-question:
   should generated files be committed (recommended: yes — `go build` works without
   running the generator; CI checks staleness) or generated on every build?
