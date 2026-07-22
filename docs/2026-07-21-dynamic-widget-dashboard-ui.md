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
- Generated files are **not committed** — same convention as the templ files
  (`*_templ.go` are gitignored, regenerated via `//go:generate go tool templ
  generate` in `lib/components/generator.go`). `zz_generated.dashica.go` gets the
  analogous `//go:generate` line and a `.gitignore` entry; dev/CI/build pipelines
  run `go generate ./...` before `go build` (mise task). Staleness is impossible
  by construction.

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
    zz_generated.dashica.go  // generated (gitignored, via go:generate like *_templ.go):
                             // serializers, editor descriptors, gocode tables
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

**Emitter mechanics — stdlib `text/template` + `go/format`, no dependency
(decided 2026-07-21).** Both this file's snippet emitter and the `dashica-gen`
serializer/descriptor emitter (4.1) build source as text via `text/template`, then
run it through `go/format.Source` (which also fixes spacing). Evaluated
`dave/jennifer` (fluent AST builder) and lighter alternatives (`go/ast`+`go/printer`,
`go-codegenutil`): jennifer's only real win is **automatic import management**, but
emitted code touches a fixed, tiny import set (`sql`, `color`, `widget`,
`encoding/json`, `bytes`) — hardcoding those imports is trivial and needs no
resolver. Templates read like the target Go, keep golden-file diffs eyeball-able,
and honour the stdlib-first ethos (zero new deps). Fallback: if conditional-call
branching or import resolution ever turns painful, swapping in jennifer is a local
change confined to the emitter.

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
named layouts; `go:generate` + `.gitignore` wiring for generated files (templ
convention) incl. mise/CI build-step integration.
*Tests:* per-widget equivalence (builder-built vs. JSON-round-tripped → identical
chartProps + SQL) over the dev-server example dashboards; generator golden tests
on a fixture package.
*Risk focus:* this proves or breaks both the single-source-of-truth claim and the
generator approach — do it first. If the generator turns out disproportionate,
fall back to plan B (exported `Opts` + runtime reflection; same wire format)
before any later phase depends on it.

Progress (updated 2026-07-21):

- [x] **`sql`-package serialization foundation** (`lib/dashboard/sql/`):
    - [x] constructor `kind` stamps (`fieldImpl.kind`; `Field`→`expr`,
      `Count`→`count`, `Enum`→`enum`; autoBucket via distinct type). Structs
      otherwise byte-identical.
    - [x] tagged-union wire format + per-type `MarshalJSON`/`UnmarshalJSON`
      (`fieldImpl`, `autoBucketFieldImpl`, `SqlQuery`, `SqlFile`, `SqlString`)
      in `serialization.go`.
    - [x] `MarshalField`/`UnmarshalField`, `MarshalQueryable`/`UnmarshalQueryable`
      interface helpers.
    - [x] `sql.FromString` / `SqlString` (+ `FromStringWithoutFilters`); shared
      `substitutePlaceholders`; `BuildWithFS` dispatch.
    - [x] round-trip tests (`serialization_test.go`) — all green.
- [x] **Widget envelope + registry** (`lib/dashboard/widget/registry.go`):
    - [x] `Register(typeName, factory)` with forward (name→factory) + reverse
      (Go type→name) maps; panics on duplicate name / Go type / untyped-nil
      factory. `RegisteredWidgetTypes()`, `NewWidgetByType()` accessors.
    - [x] tagged envelope `{"type", "props"}`; `MarshalWidget`/`UnmarshalWidget`
      delegate `props` to the widget's own JSON methods (generated later).
    - [x] `Widgets` (array) + `WidgetsMap` (object) Marshal/Unmarshal → recursive
      nesting; children live inside their parent's `props` (Grid.areas via
      WidgetsMap, CollapsibleGroup.widgets via Widgets).
    - [x] all v1 widget types registered in `init()`.
    - [x] tests (`registry_test.go`) — envelope shape, recursive round-trip via
      fake widgets, unknown/unregistered/nil handling, type discrimination over
      every registered type. Green.

  Note: real widgets currently marshal an empty `props` — their per-widget
  serializers arrive with `dashica-gen` (next step); the envelope/registry layer
  is what this step establishes.
- [x] **Named layouts** (`lib/components/layout/layout.go`):
    - [x] `layout.Layout{Name, Fn}` type + name→Layout registry (`Register`,
      `ByName`, `Names`); panics on empty name / nil Fn / duplicate.
    - [x] templ layouts renamed to unexported `defaultPageFn` / `docsPageFn`
      (in `.templ` sources; regenerated by build); exported `layout.DefaultPage`
      / `layout.DocsPage` are now `Layout` values, registered in `init()`.
    - [x] `WithLayout(l layout.Layout)` (interface + `dashboardImpl`); field type
      `layout.Layout`; render via `d.layout.Fn(...)`. All existing call sites
      `WithLayout(layout.DefaultPage)` compile unchanged (verified: lib +
      dev-server build green).
    - [x] tests (`layout_test.go`) — builtins registered, unknown, sorted Names,
      Register panics. Green.
    Note: requires `templ generate` (the templ func rename); user runs build.
- [x] **Dashboard-level serialization** (`lib/dashboard/dashboard_serialization.go`):
    - [x] `dashboardImpl` Marshal/UnmarshalJSON via `dashboardDTO`
      (`title`, `layout` (name only), `searchBar`, `widgets`). Layout stored as
      `Name`, re-resolved via `layout.ByName` (unknown name → error). searchBar is
      plain data; widgets delegate to the envelope/registry.
    - [x] `MarshalDashboard` / `UnmarshalDashboard` package helpers.
    - [x] tests (`dashboard_serialization_test.go`) — round-trip (title/layout/
      searchBar/widget-type), unknown layout error, no-layout omitted+zero. Green.
    Note: widget internals don't survive yet (per-widget serializers arrive with
    `dashica-gen`); only widget *type* round-trips at this layer.
- [x] `cmd/dashica-gen` generator + `//go:generate` wiring; `zz_generated.dashica.go`
      is **gitignored and regenerated on build** (`.gitignore` already has
      `/lib/**/zz_generated.*.go`; `//go:generate` in `lib/dashboard/widget/generate.go`;
      `.mise/tasks/build/_default` already runs `go generate ./...` before build).
      Emitter: stdlib `text/template` + `go/format`, no dependency (jennifer
      evaluated and dropped — see 4.5). Structure:
    - [x] `load.go` — go/packages load; discovers widgets from registry `init()`
      `Register(...)` calls (no second hand-maintained list); classifies every
      field into a **closed** category set (fails loudly on unsupported types);
      extracts enum values (StackOrder/StackOffset) from AST var decls; harvests
      field doc comments. Overrides via `dashica-gen:"skip"` / `"json=..."` /
      `"method=..."` struct tags (only use so far: `markdown.assets fs.FS` skip).
      Tests in `load_test.go` (classify against the real widget package).
    - [x] `emit.go` — per-widget `MarshalJSON`/`UnmarshalJSON` (map[string]RawMessage,
      strict unknown-field decode) + per-group-type serializers (StackOptions,
      enum-validated). Interface fields delegate to `sql.Marshal/UnmarshalField|
      Queryable`; `color.ColorScale` / `Widgets` / `WidgetsMap` via their own JSON
      methods. Field JSON key = Go field name (no magic rename); `id` auto-skipped.
    - [x] `summary.go` — `-dry-run` classification dump.
    - [x] Scope note: **serializers only** this step. Editor descriptors + gocode
      tables (also emittable from the same model — `Title`, `GoMethod`,
      `MethodExists`, `IsCtorArg`, `Doc`, enum options are already computed) are
      **deferred to their consuming phases (2/3)** to avoid untested dead code.
    - [x] Prereq added: `color.ColorScale.UnmarshalJSON` (hand-written, mirrors its
      `MarshalJSON`; sql-package-style exception).
- [x] Round-trip equivalence tests:
    - [x] `lib/dashboard/widget/serialization_equiv_test.go` — every registered
      v1 widget round-trips with stable JSON (marshal == remarshal); completeness
      guard fails if a new widget has no case. timeBar also asserts **identical
      chartProps + built SQL** after round trip.
    - [x] `docs/dev-server/examples/docs/serialization_roundtrip_test.go` — all 13
      dev-server example dashboards round-trip byte-stable via
      `dashboard.Marshal/UnmarshalDashboard` (none use out-of-v1-scope widgets).
    - [x] All green; `go vet` clean.


**Phase 2 — `lib/explore` runtime.**
`explore.New()` as `dashboard.Dashboard`; preview query/debug endpoints delegating
to `httpserver.QueryHandler`; formmodel + schema + values endpoints; markdown
sanitization check.
*Tests:* e2e against the dev-server: POST a widget JSON, compare response with the
equivalent compiled widget's endpoint.

Progress (updated 2026-07-21):

- [x] **Smaller `dashboard.Dashboard` interface** (`lib/dashboard/dashboard.go`):
    shrunk to the registration contract — `Title()` + `CollectHandlers()`. The
    fluent construction API moved onto the now-exported concrete `*Builder`
    (renamed from `dashboardImpl`); `New()` returns `*Builder`, builder methods
    return `*Builder` so existing chains compile unchanged. Explore satisfies the
    interface with just the two methods (no no-op builder stubs). Serialization
    + tests updated to `*Builder`.
- [x] **Column introspection moved into the clickhouse client**
    (`lib/clickhouse/introspect_schema.go`): `IntrospectedSchema` now also carries
    `Columns map[string][]Column` (name/type/comment, in schema `position` order),
    populated by the existing `system.columns` query — no separate query in
    `lib/explore`. `clickhouse.Column` type added. E2E test `introspectSchema`
    adjusted (spot-checks columns instead of full-struct equality).
- [x] **`lib/explore` runtime skeleton:**
    - [x] `explore.go` — `New(...Option) dashboard.Dashboard`; `exploreImpl`
      stashes `ctx.Deps`/`baseURL`/`MainMenu` at `CollectHandlers` time for the
      API handler closures. `Option` type defined (persistence opts land Phase 6).
    - [x] `handlers.go` — explicit route registration (root editor placeholder +
      `/api/{preview/query,preview/debug,schema,values}`); `apiHandler` error→500
      adapter matching `widget_common.go`. Editor page placeholder until Phase 3.
    - [x] `preview.go` — POST widget JSON → `widget.UnmarshalWidget` → replay the
      widget's **own** `CollectHandlers` against an in-memory `capturingCollector`
      → dispatch the request to the captured `/query` (or `/debug`) handler. Reuses
      the exact compiled path (`RegisterQueryHandlers`→`QueryHandler`), no parallel
      execution logic. Rejects non-POST, empty/null, non-`InteractiveWidget`.
    - [x] `schema.go` — serves `client.IntrospectSchema` verbatim.
    - [x] `values.go` — top distinct values (LIMIT 100, most-frequent first) for
      autocomplete; validates table/column against `^[A-Za-z_][A-Za-z0-9_]*$`
      before interpolating into SQL.
    - [x] tests (`preview_test.go`, `values_test.go`) — DB-free: fake echo widget
      proves dispatch reaches the widget's query handler with the request intact;
      capturing-collector path recording; rejection paths; values validation.
      Green. (DB-backed preview-vs-compiled e2e needs a running ClickHouse.)
- [x] **formmodel endpoint** (`/explore/api/formmodel`):
    - [x] `dashica-gen` now emits editor descriptors (`cmd/dashica-gen/descriptors.go`):
      per-widget `WidgetDescriptor{Title, HasQuery, Fields}` into
      `zz_generated.dashica.go`. Editor kind derived from field category
      (`field`/`text`/`int`/`bool`/`select`/`colorScale`/`keyValue`/`stringList`/
      `group`/`children`); the query field is excluded from `Fields` and flagged
      via `HasQuery`; enum fields carry `Options`; groups nest `Fields`; doc
      comments become `Help`; `x` gets `Required`+`Timestamped`.
    - [x] Descriptor **types** hand-written in `lib/dashboard/widget/formmodel.go`
      (stable contract); the **data** var + `WidgetDescriptors()` accessor are
      emitted into the generated file — deliberately NOT hand-written, so the
      generator can still load/parse the package on a clean checkout (a
      hand-written reference to the generated var would make it uncompilable in
      that window).
    - [x] `lib/explore/formmodel.go` — serves `{widgets: {<wire>: descriptor +
      defaults}, layouts: [...]}`. Defaults are derived at request time by
      marshalling a zero-value factory instance (accurate by definition), not
      baked into the descriptor. Layouts from `layout.Names()`.
    - [x] route registered + `handlers_test` updated; `formmodel_test.go`
      (DB-free) asserts descriptor structure (hasQuery, required/timestamped x,
      query field excluded, enum→select options, group nesting) + defaults +
      layouts. All green; build/vet clean.
- [x] **markdown sanitization** — verified the vector and closed it via a trust
    flag rather than a sanitizer library:
    - Finding: `markdown.go` used `html.WithUnsafe()` and the rendered HTML reaches
      the page through `templ.Raw` (`widget_component/markdown.templ`) — raw HTML
      in the markdown source renders verbatim. Trusted today (all markdown is
      compiled-in); a stored-XSS vector once Explore persists other-user markdown.
      No compiled markdown relies on raw-HTML-in-source (grepped all examples/docs
      + tests — only goldmark-*rendered* tables/highlighting), so `WithUnsafe` is
      safe to drop for untrusted renders.
    - Fix: `rendering.DashboardContext` gains `UntrustedContent bool` (zero value
      false = compiled/trusted). `Markdown.BuildComponents` omits `html.WithUnsafe()`
      when set, so goldmark drops embedded `<script>`/`<iframe>`/`on*` handlers;
      GFM tables + syntax highlighting are renderer output, unaffected. Compiled
      dashboards are unchanged (trusted, may embed raw HTML).
    - The widget struct is identical whether compiled or Explore-deserialized, so
      trust rides on the render context, NOT the widget. **Invariant: every
      DashboardContext that Explore constructs sets `UntrustedContent = true`.**
      Already enforced at the one such site today (`preview.go` — no effect on
      query/debug dispatch, but keeps the seam live); Phase 3 preview and Phase 6
      stored render, which DO call `BuildComponents` (markdown → HTML), inherit
      the same discipline rather than re-deciding it.
    - Test: `markdown_test.go::TestMarkdown_UntrustedContentEscapesRawHTML` — raw
      HTML passes through when trusted, is dropped when untrusted. Green.
    - Note: markdown-level `[x](javascript:...)` link URLs are still emitted; if
      that matters, add a bluemonday pass in Phase 6 when the store lands. Raw-HTML
      injection (the primary vector) is closed.

**Phase 3 — Editor UI (structured forms + live preview + Go code tab).**
Form renderer + control set (4.4); widget tree; preview wiring through the existing
`chart` component; localStorage/share-link state; JSON power-user tab.
*Tests:* browser e2e (Playwright/Chrome MCP per CLAUDE.md): build a timeBar via
forms, see preview, see generated Go, share-link round-trip.

Progress (updated 2026-07-21) — **chart-first vertical slice shipped** (scope
chosen with the user: single chart widgets, flat widget list; grid designer =
Phase 7, Go-code tab = Phase 4; SQL inputs via `<input>`+`<datalist>`, CodeMirror
deferred to Phase 4):

- [x] **Editor page** (`lib/explore/editor.templ` → `EditorShell(baseURL)`;
  `handlers.go` renders it via `layout.DefaultPage.Fn` with the search bar
  visible so its time range drives the preview). Replaces the Phase-2
  placeholder. Real templ (compiled), not `templ.Raw`.
- [x] **`preview/render` endpoint** (`preview.go`): POST widget JSON → the
  widget's own `BuildComponents` HTML. This is how the browser gets chartType +
  chartProps — it reads the `data-chart-*` attributes off the parsed DOM node
  (native HTML unescaping), so there is **no server-side attribute scraping and
  no parallel chartProps logic**. `UntrustedContent` set. DB-free test asserts
  the markup carries `data-chart-props`.
- [x] **Frontend `frontend/explore/`** (imperative DOM — the CSP Alpine build
  forbids inline expressions; Alpine provides only the component lifecycle +
  urlState store):
    - `editor.ts` — `exploreEditor` Alpine component: loads formmodel + schema,
      owns the dashboard JSON model, three panes (tree / preview / inspector) +
      bottom drawer (Go code / JSON / SQL). localStorage autosave +
      base64-hash share link. Widget add / select / reorder / delete (flat list).
      Editable JSON power-user tab (applies live). SQL/debug tab hits
      `preview/debug`.
    - `formRenderer.ts` — generic: walks the descriptor, one control per field,
      query section on top.
    - `controls.ts` — control set: text/int/bool/select, field picker
      (autoBucket/count/enum/expr composite), query section (table + WHERE list /
      raw SQL), colorScale, keyValue, stringList, group. Column/table/value
      autocomplete via `<datalist>` from `/api/schema`.
    - `preview.ts` — POST-based preview: `preview/render` for props+type,
      `preview/query` for data, renders through the **exact** compiled `charts`
      renderers (now exported from `components/chart.ts`). Non-chart widgets fall
      back to their static server-rendered markup. Per-widget abortable refetch;
      debounced re-query on edit; re-query all on time-range change.
    - `explore.css` — Neos-style three-pane layout, theme-aware (daisyUI vars).
    - wired into `frontend/index.js` (`Alpine.data('exploreEditor', …)` + css).
- [x] **Wired into `main.go`** — both build variants (`register_sandstorm.go`,
  `register_solarwatt.go`) and the dev-server, as an "Explore" group at
  `/explore` (pure builder, no persistence). Both app tags + dev-server build.
- [x] **Pre-existing Phase-2 regression fixed:** the interface shrink (Dashboard
  = Title+CollectHandlers) had left the root app's ~35 dashboard factories
  returning `dashboard.Dashboard` while `register_*.go` calls `.WithTitle(...)`
  (now only on `*Builder`) — the whole app failed to compile. Changed those
  factories to return `*dashboard.Builder`.
- Go: `go vet ./...` clean; `lib/explore` + `lib/dashboard` tests green; both app
  build tags + dev-server compile.
- NOT yet done (deferred within Phase 3 / to later phases): whole-dashboard
  multi-widget preview polish, nested grid/group children editing (tree +
  designer, Phase 7), Go-code tab content (Phase 4), CodeMirror, browser e2e.
  **Frontend not bundled/tested in-browser** — user runs the frontend build
  (`node frontendBuild.mjs`) + `mise r watch`, then E2E.

**Phase 4 — Go code generation.**
`gocode.go`; golden tests; CI compile check; `/api/gocode`.

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

### Code review findings — Phase 1 implementation (2026-07-21, unfixed)

Review of `lib/dashboard/sql` serialization, widget registry, named layouts,
dashboard serialization, `cmd/dashica-gen` against the Sandstorm guidelines.
Findings ordered by severity; none fixed yet.

1. `cmd/dashica-gen/load.go:108` ✋ blocker — **Unknown unknowns (obvious design)**
   `findRegistrations` silently *skips* a `Register(...)` call whose factory is
   not a func literal (`factoryReturnType` returns nil → `return true`, no error).
   Such a widget stays registered at runtime but gets **no generated serializer**,
   so it marshals as empty `{}` props — stable under the round-trip tests (empty
   both ways) yet silently lossy. Fix: hard error when a Register call's factory
   type cannot be resolved; belt-and-braces: a runtime/test cross-check that every
   registered type implements `json.Marshaler`.

2. `cmd/dashica-gen/load.go:293` ✋ blocker — **Silently lossy round trip
   (information hiding)**
   Skipped fields (`id` by name convention, `dashica-gen:"skip"` e.g.
   `markdown.assets`) are dropped on marshal with no trace: a compiled dashboard
   using `TimeBar.Id(...)` (a real builder option that pins query URLs) or
   markdown assets exports fine, but the re-imported widget differs. The
   marshal==remarshal equivalence tests cannot see this (loss happens before the
   first marshal). Fix: generated `MarshalJSON` returns an error (or a collectable
   warning) when a skipped field is non-zero; document per skip why dropping is
   safe. Decide explicitly whether `id` should serialize instead.

3. `lib/dashboard/sql/serialization.go:189` ⚠ should-fix — **Inconsistent error
   strictness (define errors out of existence)**
   Widget-level JSON rejects unknown keys (generated strict switch), but the sql
   DTOs are tolerant: unknown keys, or keys of the *wrong kind* (`"path"` on
   `kind:"table"`, `"sql"` on `kind:"file"`), are silently dropped. A typo in the
   query section of a stored dashboard vanishes without error while the same typo
   one level up fails loudly. Fix: strict-key check per kind in
   `UnmarshalQueryable`/`UnmarshalField`, mirroring the generated widgets.

4. `lib/dashboard/dashboard_serialization.go:23` ⚠ should-fix — **Information
   leakage across packages**
   `dashboardDTO` embeds `rendering.SearchBarOption` (and its `FilterButton`)
   directly, so a rendering-package struct silently *is* wire format: its
   PascalCase field names (`IsVisible`, `FilterButtons`, `QueryPart`) leak into
   otherwise-camelCase JSON, and any rename there breaks stored dashboards with no
   compiler or test signal. Fix: a small searchBar DTO in the dashboard package
   (owning the wire names), or json tags + an explicit "this is wire format"
   comment + drift-guard test on `SearchBarOption`.

5. `lib/dashboard/sql/serialization.go:161` ⚠ should-fix — **Change amplification
   (missing drift guard)**
   The sql serializers are hand-written by design, but nothing fails when someone
   adds a field to `SqlQuery`/`SqlFile`/`SqlString` and forgets the DTO — the
   "fails loudly" guarantee exists only on the generated widget path. Fix: a
   reflect-based guard test asserting the expected field count/names per struct
   (comment in the struct pointing at it), so drift becomes a red test.

6. `lib/dashboard/widget/registry.go:203` 💡 suggestion — **Duplication**
   `isJSONNull` exists identically in `sql` and `widget`. Acceptable (exporting it
   for this would be worse); consider a shared internal util package only if a
   third copy appears.

7. `lib/dashboard/dashboard_serialization.go:36` 💡 suggestion — **Interface
   comment / default semantics**
   `dashboard.New()` defaults `searchBar.IsVisible = true`, but unmarshalling JSON
   that omits `searchBar` yields `false`. Round trips are unaffected (marshal
   always emits the key); hand-written/store JSON silently hides the search bar.
   Fix: document, or default to visible when the key is absent.

8. docs §4.1 (3) 💡 suggestion — **Doc drift**
   The design doc's envelope sketch still shows a `"children"` key on the
   envelope; the implementation (correctly) nests children inside the parent's
   `props` (Grid.areas via `WidgetsMap`). Update the doc example.

9. Phase 2/5 planning note (from `registry.go:97`): `MarshalWidget` errors on
   unregistered types (loud — good), which means "Open in Explore" fails wholesale
   for dashboards containing out-of-v1-scope widgets (alertOverview, schemaTable,
   speedscopeLink). Phase 5 needs a defined behavior: skip-with-placeholder vs.
   error.

10. Phase 3 planning note (from `load.go:322`): constructor-argument options
    (`NewCheckboxGroup(name, label, options)`, `NewTextInput(...)`) have
    `MethodExists=false` and only the query field is modeled as a ctor arg — the
    gocode emitter must handle multi-arg constructors or these widgets get
    non-compiling generated Go.

**Summary:** the layering (hand-written sql vocabulary + generated widget layer +
envelopes only at interface boundaries) matches the design and is clean; registry
and layout packages are tidy. The dominant theme is **silent lossiness at the
edges** — findings 1–3 are all "data vanishes without an error" in different
places; fixing them establishes the invariant the whole Explore feature rests on:
*serialization either round-trips faithfully or fails loudly.*

### Code review findings — Phase 2 slice (`lib/explore` runtime, 2026-07-21, unfixed)

Review of `lib/explore/*` plus the core adjustments of this slice
(`dashboard.go` interface shrink, `introspect_schema.go` columns,
`dashica-gen/descriptors.go`, `widget/formmodel.go`, markdown
`UntrustedContent`). Findings ordered by severity; none fixed yet.

1. `lib/dashboard/widget/markdown.go:80` ✅ FIXED — **Server-side file read
   reachable from untrusted widget JSON**
   `Markdown.file` is serialized, deserializable, and even offered by the
   generated descriptor as a plain text editor field (`{Name: "file", Editor:
   "text"}`) — while `BuildComponents` did `os.ReadFile(m.file)` on the **host
   filesystem** (not projectFS). Not exploitable in Phase 2 (preview only
   dispatches query handlers; markdown has none), but the moment Phase 3/6
   renders untrusted widgets, this was an arbitrary-file-read-and-display
   primitive (`{"type":"markdown","props":{"file":"/etc/passwd"}}`).
   - Fix (option b): `BuildComponents` now (1) **refuses `File()` entirely when
   `ctx.UntrustedContent`** (Explore-authored markdown may only use inline
   `Content()`), and (2) for trusted content resolves the path against
   `ctx.Deps.FileSystem` (projectFS) via `fs.ReadFile` with an `fs.ValidPath`
   check — the host filesystem is no longer reachable at all; absolute/`..`
   paths are refused. `os` import dropped.
   - Tests: `markdown_test.go` — `TestMarkdown_File` (projectFS via `fstest.MapFS`),
   `TestMarkdown_FileRejectedForUntrustedContent`, `TestMarkdown_FileRejectsHostAbsolutePath`.
   - Left as-is: `file` still serializes (round-trip preserved, now safe) and the
   descriptor still lists `file` as an editor field — a UX nicety to hide/disable
   for untrusted widgets later, not a security boundary. Same sweep still open:
   audit other widget fields for host-FS/ambient-authority values before
   render-of-untrusted lands.

2. `lib/dashboard/rendering/rendering_context.go:31` ⚠ should-fix — **Fail-open
   trust default (define errors out of existence)**
   `UntrustedContent bool` means the *zero value is trusted*: any future Explore
   code path that forgets to set the flag renders untrusted markdown with raw
   HTML — the documented invariant is enforced by convention only. Compiled
   dashboards construct their context in exactly one place (`dashica.go`
   `RegisterDashboard`), so inverting the flag (`TrustedContent`, zero value =
   untrusted, set `true` at that single site) makes forgetting fail safe instead
   of fail open. Cheap now, painful after more call sites exist.

3. `lib/explore/preview.go:124` ⚠ should-fix — **Interface that lies
   (nondeterminism)**
   `findBySuffix` iterates a Go map — random order — but the comment claims the
   first match is "deterministically enough". A container widget (Grid *is* an
   `InteractiveWidget`) registers several `/query` handlers, so previewing one
   returns a random child's data per request. Fix: error when more than one
   handler matches ("preview accepts a single leaf widget"), or dispatch by
   explicit widget id; delete the comment's claim either way.

4. `lib/explore/values.go:47` ⚠ should-fix — **Doc/contract mismatch, unbounded
   scan**
   §4.3 promises values are "`LIMIT`ed, **time-bounded**"; the implementation
   scans the entire table (`GROUP BY` over all rows, no time predicate) — on the
   big log tables this is an expensive full-column scan fired by autocomplete.
   Fix: bound it (e.g. `WHERE timestamp > now() - INTERVAL 7 DAY` when the table
   has a `timestamp` column — the schema introspection knows) and/or cache per
   (table, column).

5. `lib/clickhouse/introspect_schema.go:15` ⚠ should-fix — **Special-purpose
   policy inside the general-purpose layer** (pre-existing, now user-facing)
   `tableListQuery` hardcodes Sandstorm's table-name prefixes (`full_%`, `mv_%`,
   `proapp_%`, `temp_%`) inside the generic library. Until now this only fed the
   search-bar sidebar; with Explore it decides **which tables the table picker
   offers at all** — silently incomplete for any project with other names. Fix:
   make the filter configurable (dashica_config or an option), defaulting to the
   current list.

6. `lib/explore/handlers.go:42` 💡 suggestion — **Error semantics**
   `apiHandler.asHTTP` maps every error to 500 — including wrong method (405),
   malformed widget JSON, and missing query args (400). Matches the compiled
   widget endpoints' style, but the Phase 3 editor will want to distinguish
   "your input is invalid" (show inline) from "server broke" (show toast);
   a typed client-error return now is cheaper than retrofitting.

7. `lib/explore/schema.go:14` / `values.go:42` 💡 suggestion — **`"default"`
   server hardcoded**
   Queries can target other ClickHouse servers (`sql.OnDatabase`), but schema and
   values autocomplete only ever describe `default` — the editor cannot offer
   pickers for widgets on another database. Plan a `?database=` parameter for
   both endpoints (validated against the configured client names).

8. `lib/clickhouse/introspect_schema.go:111` 💡 suggestion — **Pre-existing
   oddities newly load-bearing**
   (a) The common-columns condition `columnsPerTable[column] == nil` indexes a
   map keyed by *table* with a *column* name — likely a long-standing accident
   that only excludes columns sharing a table's name; worth a deliberate look
   now that Explore consumes this data. (b) `introspectedSchemaCached` never
   invalidates, so the editor's pickers go stale after any `ALTER TABLE` until
   process restart — consider a TTL.

9. Docs/comments 💡 suggestion — **Phase-number drift**
   The doc renumbered phases (editor UI = Phase 3, gocode = Phase 4), but
   `explore.go`/`handlers.go` comments still say "Phase 4 editor" / "Phase 3
   preview", and the Phase-2 promised DB-backed preview-vs-compiled e2e is
   honestly marked open in the checklist but easy to lose — carry it into the
   Phase 3 test list explicitly.

**Summary:** the runtime slice is architecturally sound — the
capturing-collector replay in `preview.go` is the standout: previews run the
*identical* compiled query path instead of a parallel engine, which is exactly
what the design demanded. The theme this round is **trust seams**: findings 1–2
are both "untrusted content meets ambient authority with a fail-open default",
and they must be closed before any phase that renders untrusted widgets.
Tackle 1 and 2 together (one trust sweep), then 3–4 before the editor makes
preview and autocomplete hot paths.

### Code review — Explore frontend (consolidated, 2026-07-22; supersedes the two earlier frontend review rounds)

Scope: `frontend/explore/{editor,controls,formRenderer,preview}.ts` + the
preview-mode additions to `frontend/components/chart.ts`.

**Architecture verdict (settled).** Not idiomatic Alpine — deliberately and
correctly: the CSP Alpine build forbids expressions with arguments, and a
recursive schema-driven form does not fit Alpine templates. Since 2026-07-22 the
editor runs on Alpine's reactive *engine* headlessly (`Alpine.reactive`/`effect`/
`release`/`raw`): two reactive roots (`state`, `ui`) with named effects for each
derived surface; the `update()`/`onEdit()` pipelines are gone — controls write
into the reactive props proxy and effects react (see the reactive-dataflow section
below). `validateState` on JSON/hash input and XSS-safe `textContent` messaging
remain. The preview design is the standout and is the pattern to protect:
`/api/preview/render` returns the widget's **own server-rendered markup** and the
real `chart` Alpine component takes over via `data-preview-base`/`data-preview-body`
— chartProps, debug drawer and time-range reactivity all have exactly one
implementation, shared with compiled dashboards.

Resolved (verified in current code): share-link XSS · render-plumbing change
amplification · half-Alpine state · unvalidated state swallow · client-side
chartProps assembly · **stale JSON-tab previews** (former #2 — `applyState` tears
previews down so reconcile rebuilds them against the new widget objects) · **stale
column datalists** (former #4 — `attachColumnCompletion` repopulates on input
`focus`) · **`start()` failure mode** (former #6 — now try/catch → inline "Explore
API unavailable" message). Cross-reference, tracked in the Phase-2 backend list,
not here: the markdown `file` `os.ReadFile` is **live** via `/api/preview/render`
(backend finding; fix before any further frontend work builds on preview/render).

Open findings:

3. `frontend/explore/controls.ts` (seed()) ⚠ should-fix — **`seed()` duplicates Go
   constructor internals** (the one finding to survive every round; the reactive
   rewrite does NOT touch it — semantic, not derived-state): `count(*)` with
   alias `count` where Go's `sql.Count()` uses `cnt`; the `::String` cast of
   `sql.Enum` built on write *and* stripped for display; `alias: 'time'`.
   When a constructor changes, the client silently drifts. Fix: semantic wire
   kinds (`enum` carries `column`; `sql.UnmarshalField` calls the real
   constructor) or per-kind seed objects served in the formmodel. The client
   should know *kinds*, never SQL text.

5. `frontend/explore/controls.ts` (keyValueControl) 💡 suggestion — **keyValue
   control writes phantom keys.** The value input writes `map[kIn.value]` *live*
   while the old key is only deleted on the key input's `change` (blur). Editing a
   key and then typing a value before blurring leaves both old and new keys in the
   map — saved and previewed. Commit key+value atomically on blur/change instead of
   value-writes-through-current-key-text.

7. `frontend/explore/controls.ts:42` 💡 suggestion — **DOM assembly noise:
   use the `htl` `html` tag already in the bundle.** ~60 % of
   `controls.ts`/`editor.ts` is `createElement`/`append` boilerplate. The
   codebase already depends on `htl` (Observable's Hypertext Literal —
   `import {html} from "htl"`, used by `chart/table.ts` and `chart/stats.ts`):
   auto-escaping tagged templates that return real DOM nodes and accept inline
   event handlers (`<button onclick=${fn}>`), CSP-compatible, zero new
   dependency. Adopting it for controls/toolbar/tree would roughly halve those
   files. Note its limit: no keyed re-render, so the `redraw()` closures stay —
   fine, they are small. (This replaces the earlier lit-html suggestion.)

8. `frontend/explore/preview.ts:17` 💡 suggestion — `(Alpine as any)
   .destroyTree` is a private API; add a graceful fallback (swap the container
   node) so an Alpine upgrade degrades to a small leak-free re-mount instead of
   breaking previews.

9. `frontend/explore/editor.ts` (shareUrl/loadState) 💡 suggestion — share-link
   codec still uses deprecated `escape`/`unescape` + `btoa`, with no URL-length
   guard; move to `lz-string` (per §4.4) and warn when the link exceeds ~2 kB.

**Summary:** the reactive-dataflow rewrite (below) closed the whole derived-state
drift class — stale previews and stale datalists (former #2/#4) are gone by
construction, and `start()` now fails visibly (#6). What remains: the one recurring
one-source-of-truth violation (#3 — semantic, not derived-state, so the rewrite
did NOT touch it; do it next), the keyValue commit semantics (#5), and cheap
robustness/readability wins (#7 adopt `htl`, #8 `destroyTree` fallback, #9
`lz-string` share links).

### Frontend architecture revision — reactive dataflow (2026-07-22, IMPLEMENTED — not yet built/E2E'd)

**Implemented 2026-07-22** exactly as proposed below. `editor.ts` rewritten
around two reactive roots (`state`, `ui`) with named effects (persist /
toolbar-sync / tree / inspector / preview-reconcile / drawer-chrome / json-sync);
`update()`/`onEdit()` deleted. All five guardrails applied — the inspector effect
tracks only `(selectedId, widget.type)` and defers the form build to a microtask
(untracked prop reads → no defocus); focused text inputs are never overwritten;
per-card preview effects track `JSON.stringify(props)` coarsely and are
`Alpine.release`d on removal. `controls.ts` had `ControlCtx.onChange` and all its
call sites removed (controls write straight into the reactive props proxy) and its
build-once `columnDatalist` replaced by a focus-repopulating `attachColumnCompletion`
— so the stale-datalist finding (#4) and the stale-JSON-tab-preview finding (#2)
are both closed by construction. `preview.ts`, `formRenderer.ts`, the server API
and the wire format were left untouched, as planned. Still deferred to the next
steps (unchanged by this rewrite): the semantic findings (seed() duplication #3,
keyValue commit #5) and the markdown-`file` backend blocker, which must land before
untrusted render. The build (esbuild + browser E2E) is the user's to run.

Original proposal (kept for rationale):



Question: would rebuilding the Explore UI as a reactive dataflow reduce
complexity and bugs? **Yes — with eyes open about which bugs.** Look at the
review history: stale selection highlight, stale JSON-tab previews, stale
column datalists, forgotten persist calls, the update()/onEdit() dual pipeline
itself. Every one is the same disease — *derived state (DOM, previews,
storage) drifting from source state because a human had to remember what
depends on what*. That is precisely the class of bug a reactive dataflow
eliminates by construction. It does NOT help with the semantic findings
(seed() duplication, state migration, commit semantics of the keyValue
control) — those stay.

**Key fact: no new framework is needed.** The CSP constraint only rules out
Alpine *templates*. Alpine's reactive *engine* (`Alpine.reactive`,
`Alpine.effect`, `Alpine.release` — it is @vue/reactivity underneath) is
importable and usable headlessly from plain TS. The editor keeps its
manual-DOM rendering, but re-rendering becomes *subscription* instead of
*orchestration*:

```ts
const state = Alpine.reactive(loadState());          // single source of truth
const ui    = Alpine.reactive({selectedId: null, drawerTab: 'data'});

Alpine.effect(() => persistDebounced(JSON.stringify(state)));      // storage follows state
Alpine.effect(() => renderTree(state.widgets, ui.selectedId));     // tree follows structure
Alpine.effect(() => renderInspector(ui.selectedId, selectedType())); // see guardrail 1
// one effect PER preview card, created when the widget mounts:
Alpine.effect(() => { const body = JSON.stringify(widget.props);   // coarse dep tracking
                      previewDebounced(widget.id, body); });
```

What this deletes:
- the `update()` / `onEdit()` split and every judgment call about which panes
  to redraw — mutations are just mutations, effects notice;
- **`ControlCtx.onChange` and all ~30 call sites in `controls.ts`** — controls
  simply write into the (reactive) props object; the per-widget preview effect
  and the persist effect react. This is the single biggest simplification;
- the JSON-tab staleness bug and the stale-datalist bug *as a category*
  (datalist contents become a derived computation over `query.table`).

Guardrails — the classic reactive traps, named up front:
1. **The inspector effect must depend only on `(selectedId, widget.type)`**,
   never on props values — otherwise typing rebuilds the form under the cursor
   (the defocus bug, reborn reactively). Read props inside controls via
   `Alpine.raw(...)`/untracked access. Controls remain imperative islands;
   reactivity coordinates *between* panes, not inside a control.
2. **Text inputs are written only when not focused** (JSON textarea, title
   input): `if (document.activeElement !== ta) ta.value = ...`.
3. **Coarse-grained preview deps on purpose**: `JSON.stringify(widget.props)`
   tracks everything, debounced — correct-by-default beats clever partial
   tracking here.
4. **Effect lifecycle is explicit**: effects created per widget are kept in the
   per-widget entry and `Alpine.release`d on widget removal — same place the
   preview controller is destroyed today.
5. Debugging shifts from "read the call chain" to "know what an effect
   tracked" — mitigate by keeping ONE effect per pane/widget with a name
   comment, never nested effects.

Cost: a focused rewrite of `editor.ts` (the pane orchestration, ~1–2 days) and
a mechanical simplification of `controls.ts` (delete onChange plumbing).
`preview.ts`, `formRenderer.ts`, the server API and the wire format are
untouched.

**Recommendation: do it, and do it BEFORE the UX plan below.** The Data tab,
slot-aware pickers and the time-strip-in-preview all multiply derived state
(selected table → columns → classes → picker contents → sample rows); building
them on manual orchestration will reproduce the same stale-state findings a
third time. Order: markdown-file blocker → reactive core → UX plan.

### UX plan — full-screen editor + visible data model (2026-07-22)

**Status: (1) DONE (prior session); (2) + (3) DONE (2026-07-22, this session) —
not yet built/E2E'd. (4) polish still open.** Implementation notes below each
part.

The screenshot review shows the structure is right (tree / preview / inspector)
but the editor neither owns the screen nor teaches the data. Plan, in priority
order:

**(1) Full-screen editor layout.** `editorPage` currently wraps `EditorShell`
in `layout.DefaultPage`, so the dashboard sidebar, the search-dashboards box and
the huge "Additional SQL Filters" textarea consume ~40 % of the viewport before
the editor starts — and push the bottom drawer below the fold. Fix: a dedicated
`layout.ExplorePage` (registered layout, name `"explorePage"`):
- full-viewport CSS grid `toolbar / (tree | preview | inspector) / drawer`;
  the page never scrolls, each pane scrolls itself;
- no dashboard sidebar (a small "← Dashica" home link in the toolbar);
- the time-range strip moves **inside the preview pane**, as its sticky header —
  NOT into the global toolbar. Rationale: the time range (+ log scale + SQL
  filter) is part of the *previewed dashboard's* state — it is exactly what the
  search bar renders on a real dashboard page — so it belongs where its effect
  is, above the widgets it re-queries. The editor toolbar stays editor-only
  (title, layout, share). Compact form: range buttons + custom picker +
  log-scale in one row, SQL filter collapsed behind a "filters" toggle. This
  also makes the preview pane a truthful miniature of the final dashboard page;
- drawer becomes a proper bottom sheet: tab bar always visible, content
  collapsible, height draggable;
- drawer tabs become **Data / Go code / JSON** — the "SQL / debug" tab is
  **dropped**: since the preview rework, every preview chart is the real
  `chart` component, whose wrench button already opens the standard debug
  drawer (SQL + EXPLAIN via `preview/debug`); a second SQL surface is
  redundant. `renderSqlTab` and its fetch go away.

**(2) Make the data model visible.** Adopted idea: the drawer gets a **"Data"
tab (first tab, default)** showing the *selected widget's* table:
- **columns pane**: name / type / comment straight from the already-loaded
  `/api/schema` response — no new endpoint;
- **sample rows pane**: live data via a *synthetic table-widget envelope* —
  `{type:"table", props:{sql:{kind:"table",table:<t>}, limit:50}}` POSTed
  through the existing preview/render + preview/query path. Zero new backend;
  the sample respects the current time range and filters by construction;
- **per-column top values** on click (the `/api/values` endpoint exists) — which
  doubles as a value picker for WHERE clauses and color mappings.
Additionally, inspector-side: once a table is chosen, a collapsible column
reference under the table input (name + type, click inserts the column into the
focused where/expression input).

**(3) Field picker teaches intent, not wire kinds.** (This answers the note
previously at the end of this doc: "field select `autoBucket` does not really
make sense".) The kind dropdown currently exposes serializer vocabulary
(`autoBucket`/`count`/`enum`/`expr`). Plan:
- human labels: "Time bucket (automatic)", "Row count", "Column (as category)",
  "Custom SQL expression" — labels come from the formmodel so Go stays the
  source of truth;
- for the timestamped X field there is usually **no choice to make**: default
  to auto-bucket on the table's first DateTime column the moment a table is
  picked; show the column picker, tuck "custom expression" behind an
  "advanced" toggle;
- same golden path for Y: default "Row count". Net effect: *add widget + pick
  table = a rendering chart*, instead of today's empty-chart error;
- alias inputs move under the advanced toggle (auto-derived otherwise);
- **introduce the column-class vocabulary: temporal / categorical (ordinal) /
  continuous (numeric).** Classify every column server-side from its ClickHouse
  type in `/api/schema` (one home for the mapping: `DateTime*/Date*` →
  temporal; `String/Enum*/LowCardinality/Bool/UUID/IP` → categorical; numeric →
  continuous), returned as `class` per column. The whole editor then speaks
  this vocabulary instead of raw types:
    - **slot-aware column pickers**: X (time widgets) offers temporal columns;
      Fill / Fx / Fy and the "Column (as category)" mode offer categorical
      ones; Y aggregations offer continuous ones (count needs none). Wrong-class
      columns are not hidden but demoted + badged, so escape hatches remain;
    - **badges everywhere a column appears** (pickers, Data-tab column list,
      WHERE completion): small ⏱/🏷/# markers with the class in the tooltip;
    - **class-appropriate affordances**: top-values autocomplete
      (`/api/values`) only for categorical columns (it is meaningless and
      expensive for continuous ones — offer min/max/quantiles there instead);
      color mappings only for categorical fills;
    - matches Observable Plot's own scale semantics (ordinal vs. linear vs.
      time), so the editor's language and the chart's behavior agree.

**(4) Small but visible polish** (from the screenshot):
- every input gets a persistent label — placeholder-only labeling fails the
  moment a value is set (X currently shows two anonymous filled inputs);
- toolbar: title input needs a label/placeholder ("Dashboard title" — it
  currently renders as an unlabeled mystery box), layout select gets a label
  and compact width;
- tree rows: show the widget's user title (`props.title`) when set, type name
  otherwise; fix the icon-button glyph contrast on the selected row
  (currently invisible white squares);
- Fill/Fx/Fy group into a collapsed "Series & faceting" section;
- friendly empty states: "Pick a table to see data" instead of a raw 500 body
  in the preview card.

Order: (1) is a prerequisite for (2) (the drawer must be visible to be useful);
(3) is the biggest comprehension win per line of code; (4) is cheap and can ride
along. Review finding 1 (markdown file read) goes before all of it.

**Implementation notes — (2) + (3), 2026-07-22 (this session), not yet built/E2E'd.**

Backend (Go, tests green):
- **Column classes** (`lib/clickhouse/introspect_schema.go`): `Column` gains
  `Class string` (`"temporal"|"categorical"|"continuous"|""`); `ClassifyColumnType`
  is the single home for the ClickHouse-type→class mapping (unwraps
  `Nullable`/`LowCardinality`; `Date*`→temporal, `Int/UInt/Float/Decimal`→
  continuous, `String/FixedString/Enum/UUID/IPv*/Bool`→categorical, else `""`).
  Returned per column in `/api/schema`. Unit test `introspect_schema_test.go`.
- **Field-kind intent vocabulary** (`lib/explore/formmodel.go`): `/api/formmodel`
  now also returns `fieldKinds` — `{kind,label,requiresColumn,columnClass,advanced}`
  per sql field kind (autoBucket="Time bucket (automatic)"/temporal,
  count="Row count", enum="Column (as category)"/categorical,
  expr="Custom SQL expression"/advanced). Labels + slot metadata live in Go, so
  the client speaks *intent* while Go stays source of truth. `formmodel_test.go`
  extended.

Frontend (not built/E2E'd — user runs frontendBuild + browser):
- **Field picker teaches intent** (`controls.ts fieldControl`): kind dropdown uses
  the served labels (not `autoBucket`/`expr`); a required-but-empty picker
  auto-selects its default kind (X→Time bucket, Y→Row count) so intent shows
  before a column is picked; custom-expression + alias hidden behind an
  **Advanced** toggle. Column completion is now **class-aware**
  (`attachColumnCompletion(input, ctx, preferredClass)`): preferred-class columns
  sort first, wrong-class demoted (not hidden), every option badged
  (⏱/🏷/#) + type in its label.
- **Golden path** (`formRenderer.ts` + `controls.ts seedRequiredFields`): choosing
  a table seeds required-empty pickers (X=auto-bucket on first temporal column,
  Y=row count) and rebuilds **only** the options section (query section keeps
  focus) — "pick a table = a rendering chart". `ctx.onTableChosen` is the single
  hook; it never clobbers user-set values.
- **Column reference** (`controls.ts columnReference`): collapsible `<details>`
  under the table input listing badge+name+type; clicking a column inserts its
  name at the cursor of the last-focused WHERE/expression input
  (module-level `lastSqlInput`).
- **Data tab** (`editor.ts buildDataTab`): first/default drawer tab. Left =
  columns pane (badge/name/type/comment from the already-loaded `/api/schema`;
  categorical columns get a class-appropriate **values** button →
  `/api/values`). Right = live **sample rows** via a synthetic
  `{type:"table", props:{sql:{kind:"table",table}, limit:50}}` envelope pushed
  through the existing `mountPreview` (preview/render + preview/query) — zero new
  backend, respects time range + filters. The drawer effect reads only the
  selected widget's query *table* reactively, so it refreshes on table change but
  not on unrelated prop edits; the sample preview is torn down on every drawer
  rebuild.
- CSS: badges, advanced toggle, column reference, Data-tab two-pane grid + values
  list (`explore.css`).

Still open (unchanged by this session): review finding 1 (markdown `file`
`os.ReadFile` via `/api/preview/render`) — must land before any untrusted
render; (2)/(3) do not render untrusted markdown (Data tab = synthetic table
widget; pickers = pure UI) so they were not gated on it. Frontend review #3
(`seed()` duplicates Go constructor SQL text — `count(*)`, `::String`) survives:
this session kept the existing wire behavior rather than widening scope; fix via
semantic wire kinds when touched. Continuous-column min/max/quantiles affordance
(doc's alternative to top-values) not built — only categorical values offered.
UX plan (4) polish (persistent labels, "Series & faceting" grouping, friendly
empty states) still open.

### Proposal — Arrow-incompatible ClickHouse types, handled Go-side (2026-07-22, not implemented)

**Problem.** ClickHouse cannot serialize its `JSON` / `Object('json')` /
`Dynamic` / `Variant` column types into Arrow — Dashica's wire format for all
chart data. Any query whose *result* contains such a column fails
(`DB::Exception: The type 'JSON' of a column 'event_original' is not supported
for conversion into Arrow`). `full_logs.event_original` is exactly such a
column, so every `SELECT *` over the main log table breaks.

**Why the current fix is wrong.** The stop-gap lives in
`frontend/explore/editor.ts` (`sampleQuery()`): the *client* reads column types
from `/api/schema` and assembles a `SELECT * REPLACE(toString(col) AS col, …)`
SQL expression into the wire format. Three layering violations at once —
SQL text generated in TypeScript (violates "kinds on the wire, SQL text only
in Go"), schema knowledge duplicated client-side, and Arrow (a *transport*
detail) leaking into UI code. And it only fixes the Data tab: a user-built
table widget, a compiled dashboard's `SELECT *`, or any raw/.sql query over a
JSON column still errors.

**Options considered.**

| Option | Verdict |
|---|---|
| Client-side REPLACE from schema (current stop-gap) | Rejected — layering (above), covers one call site of many. |
| ClickHouse output setting | Does not exist — CH has no Arrow serializer for these types at all. |
| Table widget injects REPLACE at build time (schema-aware widget) | Rejected — widgets/SqlBuilder are deliberately DB-blind; and raw/.sql queries stay broken. |
| Different transport format (JSON) for affected queries | Rejected — bifurcates the frontend decode path (everything consumes Arrow). |
| **Transport-level rewrite in `lib/clickhouse` (chosen)** | Arrow is this layer's concern; fixes every caller — compiled, dynamic, Data tab, raw SQL — with zero widget/frontend knowledge. |

**Chosen design: DESCRIBE + wrap, inside the ClickHouse client.**
`DESCRIBE (<query>)` returns the *result* columns and types of an arbitrary
query without executing it. In `Client.QueryToHandler` (the only Arrow path),
before sending the real query:

```go
// lib/clickhouse/arrow_compat.go
// ensureArrowCompatible rewrites a query whose result contains columns that
// ClickHouse cannot serialize to Arrow (JSON/Object/Dynamic/Variant), by
// wrapping it and casting exactly those columns to String in place:
//   SELECT * REPLACE(toString(`c1`) AS `c1`, ...) FROM ( <original query> )
// All other columns keep their native types. No-op when Format != Arrow or
// no such column is present.
func (c *Client) ensureArrowCompatible(ctx context.Context, sql string, opts QueryOptions) (string, error) {
    if opts.Format != "Arrow" { return sql, nil }
    cols, err := c.describeQuery(ctx, sql, opts) // DESCRIBE (<sql>), same params/settings, TSV
    // ... filter cols whose type matches (?i)\b(JSON|Object|Dynamic|Variant)\b
    // ... none → return sql; some → build the REPLACE wrap, return
}
```

Details:
- **Trigger**: `Format == "Arrow"` only — JSON/debug/alerting paths untouched.
- **Detection**: on the query *result* (DESCRIBE of the built SQL, after
  filter/placeholder substitution) — works uniformly for `SqlQuery`, `SqlFile`
  and `SqlString`; no SQL parsing anywhere.
- **Rewrite**: `* REPLACE(...)` preserves column names, order and all
  non-affected types (numbers stay numbers for charts). Backtick-escape column
  names.
- **Cost**: one DESCRIBE round-trip per query execution (~ms, no data read) —
  negligible next to the actual query. No caching: simpler, and never stale.
  Add one only if profiling ever shows the DESCRIBE mattering.
- **Params**: DESCRIBE receives the same `{param:Type}` parameters as the real
  query — parameterized queries describe fine.

**Must-test risk: row order through the wrap.** An outer `SELECT … FROM
(subquery)` has no ORDER BY of its own; ClickHouse preserves the subquery's
order in practice for a plain pass-through, but it is not contractually
guaranteed. The e2e test must cover an ORDER BY + `WITH FILL` query over a
JSON-column table. Contingency if order is ever lost: apply
`SETTINGS max_threads=1` to wrapped queries only (they are the exception, not
the rule).

**Cleanup**: revert `sampleQuery()` in `editor.ts` to the plain
`{kind: 'table', table}` envelope — the transport layer now owns the concern.
*Tests*: unit (detection regex, wrap SQL, cache); e2e against the dev
ClickHouse: table widget + Data-tab sample over `full_logs`
(`event_original JSON`), plus the ORDER BY/WITH FILL ordering check above.

### UX note — parameter widgets do not belong in the add-widget list (2026-07-22)

"Text Input" and "Checkbox Group" currently appear in Explore's add-widget
dropdown. They are *dashboard parameter* widgets — they render an input bound
to `$store.urlState.widgetParams[name]`, which only does anything when some
*other* widget's query references `{name:String}`. Standing alone in Explore
they produce a lone input that affects nothing — justified confusion.

They must stay **registered/serializable** (compiled dashboards use them, and
"Open in Explore" must round-trip them), but the editor should treat them as a
separate category:
- descriptor gains a `category: "chart" | "parameter" | "container"` field
  (emitted by dashica-gen from a per-widget registry hint — one line per
  widget, next to `Register(...)`);
- the add-widget dropdown groups them under "Parameters" with help text
  ("provides a `{name:String}` query parameter for other widgets"), or hides
  them entirely until a later phase that also teaches the query section to
  *reference* parameters — hiding is the honest v1 (recommended);
- same mechanism sorts the container widgets (grid, collapsibleGroup — already
  stubbed in the inspector) out of the flat "chart" list. 