package explore

import (
	"encoding/json"
	"fmt"
	"go/format"
	"sort"
	"strconv"
	"strings"
	"unicode"

	"github.com/sandstorm/dashica/lib/dashboard/widget"
)

// This file implements the Go-code generator — docs requirement #1: Explore
// continuously shows the fluent-builder Go for whatever is being edited, so a
// dashboard prototyped in the browser copy/pastes verbatim into the repo.
//
// It turns a dashboard state (the editor's JSON, identical to the dashboard wire
// format) into `dashboard.New().WithLayout(...).Widget(...)...` source. The
// field↔builder-method mapping comes from the generated table
// (widget.WidgetGocodeJSON(), emitted by dashica-gen and verified at generation
// time, decoded into widgetGocodeTable); the per-type VALUE emitters
// (sql.AutoBucket("ts"), color.New(...), literals) live here, next to the wire
// format they read. go/format lays out the final source (jennifer was rejected:
// the import set is fixed and small).
//
// The generator reads the same serialized wire format the round-trip serializers
// produce, so its output round-trips: emitted Go, compiled and re-marshalled,
// yields the JSON it started from (asserted by the tests).

// WidgetGocode describes how to reconstruct one widget type as a fluent Go
// builder chain: the constructor call plus the chained option methods. It (and
// GocodeField / GocodeEnumValue below) is the Go model of the JSON table
// dashica-gen emits into the widget package (WidgetGocodeJSON()); Go-code
// generation is an Explore concern, so these types live here, not in
// lib/dashboard/widget. See docs §4 Step 4.
type WidgetGocode struct {
	// Constructor is the factory function name, e.g. "NewTimeBar", emitted
	// qualified as widget.NewTimeBar.
	Constructor string `json:"constructor"`
	// CtorArgs are the fields passed positionally to Constructor, in parameter
	// order (the SqlQueryable of a chart; name/label/options of a checkboxGroup).
	CtorArgs []GocodeField `json:"ctorArgs,omitempty"`
	// Methods are the chained builder calls, in struct-field order.
	Methods []GocodeField `json:"methods,omitempty"`
}

// GocodeField maps one widget field to the builder call that sets it, carrying
// exactly what the value emitter needs.
type GocodeField struct {
	// JSONKey is the field's wire key.
	JSONKey string `json:"jsonKey"`
	// Method is the builder method name (empty for a constructor argument, or for
	// a struct field the fluent API never exposes).
	Method string `json:"method,omitempty"`
	// Kind is the field category selecting the value emitter (queryable/field/
	// tsField/optField/string/int/int64/bool/ptrInt/ptrBool/color/keyValue/
	// stringList/group/enum/childrenList/childrenMap).
	Kind string `json:"kind"`
	// MethodParams is the builder method's parameter count; 0 marks a no-arg
	// toggle (Open(), PrependCaret()).
	MethodParams int `json:"methodParams,omitempty"`
	// MethodVariadic is true when the method's last parameter is variadic
	// (Template(...string), Color(...ColorScaleOption)).
	MethodVariadic bool `json:"methodVariadic,omitempty"`
	// Fields are a group's sub-fields (kind == "group").
	Fields []GocodeField `json:"fields,omitempty"`
	// GroupType is a group's Go struct type name (kind == "group"), e.g.
	// "StackOptions".
	GroupType string `json:"groupType,omitempty"`
	// EnumValues maps each enum wire string to its Go var (kind == "enum"), e.g.
	// "sum" -> "OrderSum", so the emitter renders widget.OrderSum.
	EnumValues []GocodeEnumValue `json:"enumValues,omitempty"`
}

// GocodeEnumValue pairs an enum's wire string with its Go var name.
type GocodeEnumValue struct {
	Str     string `json:"str"`
	VarName string `json:"varName"`
}

// widgetGocodeTable is the decoded Go-code-generation table, parsed once from
// the generated JSON blob. A malformed blob is a build-time generator bug, so we
// panic rather than degrade.
var widgetGocodeTable = func() map[string]WidgetGocode {
	var t map[string]WidgetGocode
	if err := json.Unmarshal([]byte(widget.WidgetGocodeJSON()), &t); err != nil {
		panic("explore: decoding widget gocode table: " + err.Error())
	}
	return t
}()

const (
	pkgDashboard = "github.com/sandstorm/dashica/lib/dashboard"
	pkgWidget    = "github.com/sandstorm/dashica/lib/dashboard/widget"
	pkgLayout    = "github.com/sandstorm/dashica/lib/components/layout"
	pkgSQL       = "github.com/sandstorm/dashica/lib/dashboard/sql"
	pkgColor     = "github.com/sandstorm/dashica/lib/dashboard/color"
)

// gocodeState is the input: the editor's dashboard state, which is the dashboard
// wire format (title + layout name + widget envelopes). The per-widget `id` (the
// editor tree id) is not part of the builder API, so it is ignored.
type gocodeState struct {
	Title   string            `json:"title"`
	Layout  string            `json:"layout"`
	Widgets []json.RawMessage `json:"widgets"`
}

// widgetWire is one widget as {type, props} (plus an ignored editor id).
type widgetWire struct {
	Type  string          `json:"type"`
	Props json.RawMessage `json:"props"`
}

// fieldWire mirrors sql's fieldDTO (lib/dashboard/sql/serialization.go). Kept
// local so the emitter reads the wire format directly; drift is caught by the
// round-trip test.
type fieldWire struct {
	Kind          string `json:"kind"`
	Definition    string `json:"definition"`
	Alias         string `json:"alias"`
	Column        string `json:"column"`
	XBucketSizeMs int64  `json:"xBucketSizeMs"`
}

// queryWire mirrors sql's queryDTO.
type queryWire struct {
	Kind                  string            `json:"kind"`
	Table                 string            `json:"table"`
	Select                []json.RawMessage `json:"select"`
	GroupBy               []json.RawMessage `json:"groupBy"`
	OrderBy               []json.RawMessage `json:"orderBy"`
	Limit                 int               `json:"limit"`
	FillStep              string            `json:"fillStep"`
	AutoBucketPlaceholder bool              `json:"autoBucketPlaceholder"`
	Path                  string            `json:"path"`
	Sql                   string            `json:"sql"`
	Where                 []string          `json:"where"`
	Database              string            `json:"database"`
	SkipFilters           bool              `json:"skipFilters"`
	AutoBucket            bool              `json:"autoBucket"`
}

// colorWire mirrors color's colorScaleDTO.
type colorWire struct {
	Legend  bool     `json:"legend"`
	Domain  []string `json:"domain"`
	Range   []string `json:"range"`
	Unknown string   `json:"unknown"`
	Type    string   `json:"type"`
	Scheme  string   `json:"scheme"`
}

const defaultColorUnknown = "#8E44AD" // color.New default; omitted from emitted opts

// generator accumulates the imports the emitted source actually references, so
// the import block carries no unused entries (which would break the CI compile
// check).
type generator struct {
	table   map[string]WidgetGocode
	imports map[string]bool
}

// GenerateDashboardCode turns a dashboard state (editor JSON / dashboard wire
// format) into gofmt'd Go source that rebuilds it via the fluent builder API.
func GenerateDashboardCode(stateJSON []byte) (string, error) {
	var st gocodeState
	if err := json.Unmarshal(stateJSON, &st); err != nil {
		return "", fmt.Errorf("gocode: parse state: %w", err)
	}

	g := &generator{table: widgetGocodeTable, imports: map[string]bool{}}
	g.imports[pkgDashboard] = true

	var b strings.Builder
	b.WriteString("dashboard.New()")
	if st.Title != "" {
		fmt.Fprintf(&b, ".\nWithTitle(%s)", strconv.Quote(st.Title))
	}
	if st.Layout != "" {
		g.imports[pkgLayout] = true
		fmt.Fprintf(&b, ".\nWithLayout(layout.%s)", upperFirst(st.Layout))
	}
	for i, raw := range st.Widgets {
		expr, err := g.emitWidget(raw)
		if err != nil {
			return "", fmt.Errorf("gocode: widget %d: %w", i, err)
		}
		fmt.Fprintf(&b, ".\nWidget(\n%s,\n)", expr)
	}

	return g.assembleFile(b.String())
}

// assembleFile wraps the dashboard expression in a compilable file and gofmt's
// it. Wrapping in a function returning dashboard.Dashboard makes the output a
// self-contained, directly-compilable unit (the CI compile check builds it).
func (g *generator) assembleFile(dashboardExpr string) (string, error) {
	var b strings.Builder
	b.WriteString("// Code generated by Dashica Explore. Copy into your repo and register\n")
	b.WriteString("// the returned dashboard with Dashica, e.g.:\n")
	b.WriteString("//\n")
	b.WriteString("//\td.RegisterDashboardGroup(\"...\").RegisterDashboard(\"/...\", Dashboard())\n")
	b.WriteString("package dashboards\n\n")

	paths := make([]string, 0, len(g.imports))
	for p := range g.imports {
		paths = append(paths, p)
	}
	sort.Strings(paths)
	b.WriteString("import (\n")
	for _, p := range paths {
		fmt.Fprintf(&b, "\t%s\n", strconv.Quote(p))
	}
	b.WriteString(")\n\n")

	b.WriteString("func Dashboard() dashboard.Dashboard {\n")
	fmt.Fprintf(&b, "return %s\n", dashboardExpr)
	b.WriteString("}\n")

	src, err := format.Source([]byte(b.String()))
	if err != nil {
		return "", fmt.Errorf("gocode: gofmt generated source: %w\n---\n%s", err, b.String())
	}
	return string(src), nil
}

// emitWidget renders one widget envelope as its fluent builder chain (recursing
// for container children). Returns an error for a widget type not in the gocode
// table (out of v1 scope).
func (g *generator) emitWidget(raw []byte) (string, error) {
	var ww widgetWire
	if err := json.Unmarshal(raw, &ww); err != nil {
		return "", fmt.Errorf("parse envelope: %w", err)
	}
	gc, ok := g.table[ww.Type]
	if !ok {
		return "", fmt.Errorf("widget type %q is not in the gocode table (out of scope for Go export)", ww.Type)
	}
	g.imports[pkgWidget] = true

	props := map[string]json.RawMessage{}
	if len(ww.Props) > 0 && !isNull(ww.Props) {
		if err := json.Unmarshal(ww.Props, &props); err != nil {
			return "", fmt.Errorf("widget %q: parse props: %w", ww.Type, err)
		}
	}

	// Constructor call with positional arguments.
	var args []string
	for _, f := range gc.CtorArgs {
		expr, err := g.emitValue(f, props[f.JSONKey], true)
		if err != nil {
			return "", fmt.Errorf("widget %q arg %q: %w", ww.Type, f.JSONKey, err)
		}
		args = append(args, expr)
	}
	var b strings.Builder
	fmt.Fprintf(&b, "widget.%s(%s)", gc.Constructor, strings.Join(args, ", "))

	// Chained builder calls, in field order; only for present (non-zero) fields.
	for _, f := range gc.Methods {
		raw, present := props[f.JSONKey]
		if !present || isNull(raw) {
			continue
		}
		calls, err := g.emitMethodCalls(f, raw)
		if err != nil {
			return "", fmt.Errorf("widget %q field %q: %w", ww.Type, f.JSONKey, err)
		}
		for _, c := range calls {
			b.WriteString(".\n")
			b.WriteString(c)
		}
	}
	return b.String(), nil
}

// emitMethodCalls returns the chained builder call(s) that set one field.
// Most fields produce exactly one call; container children produce one per
// child. A field with no builder method (Method == "") that nonetheless carries
// a value is a hard error — it cannot be reproduced in Go.
func (g *generator) emitMethodCalls(f GocodeField, raw []byte) ([]string, error) {
	switch f.Kind {
	case "childrenList":
		var children []json.RawMessage
		if err := json.Unmarshal(raw, &children); err != nil {
			return nil, err
		}
		out := make([]string, 0, len(children))
		for i, c := range children {
			expr, err := g.emitWidget(c)
			if err != nil {
				return nil, fmt.Errorf("child %d: %w", i, err)
			}
			out = append(out, fmt.Sprintf("%s(\n%s,\n)", f.Method, expr))
		}
		return out, nil

	case "childrenMap":
		var children map[string]json.RawMessage
		if err := json.Unmarshal(raw, &children); err != nil {
			return nil, err
		}
		keys := make([]string, 0, len(children))
		for k := range children {
			keys = append(keys, k)
		}
		sort.Strings(keys) // deterministic, matches Go map-key marshalling
		out := make([]string, 0, len(keys))
		for _, k := range keys {
			expr, err := g.emitWidget(children[k])
			if err != nil {
				return nil, fmt.Errorf("area %q: %w", k, err)
			}
			out = append(out, fmt.Sprintf("%s(%s,\n%s,\n)", f.Method, strconv.Quote(k), expr))
		}
		return out, nil
	}

	if f.Method == "" {
		return nil, fmt.Errorf("field %q has a value but no builder method to set it, so it cannot be reproduced in Go", f.JSONKey)
	}

	switch f.Kind {
	case "color":
		opts, err := g.emitColorOptions(raw)
		if err != nil {
			return nil, err
		}
		return []string{fmt.Sprintf("%s(%s)", f.Method, opts)}, nil

	case "bool", "ptrBool":
		if f.MethodParams == 0 {
			// A no-arg toggle (Open(), PrependCaret()): the field is only ever
			// present when true, so the call itself carries the meaning.
			return []string{f.Method + "()"}, nil
		}
		var v bool
		if err := json.Unmarshal(raw, &v); err != nil {
			return nil, err
		}
		return []string{fmt.Sprintf("%s(%t)", f.Method, v)}, nil

	case "stringList":
		if f.MethodVariadic {
			items, err := stringSlice(raw)
			if err != nil {
				return nil, err
			}
			return []string{fmt.Sprintf("%s(%s)", f.Method, strings.Join(quoteAll(items), ", "))}, nil
		}
	}

	expr, err := g.emitValue(f, raw, false)
	if err != nil {
		return nil, err
	}
	return []string{fmt.Sprintf("%s(%s)", f.Method, expr)}, nil
}

// emitValue renders a field's value as a single Go expression (constructor
// argument, or the single argument of a builder method). asArg selects the
// zero-value literal for an absent constructor argument.
func (g *generator) emitValue(f GocodeField, raw []byte, asArg bool) (string, error) {
	absent := raw == nil || isNull(raw)

	switch f.Kind {
	case "queryable":
		if absent {
			return "nil", nil
		}
		return g.emitQueryable(raw)

	case "field", "optField", "tsField":
		if absent {
			return "nil", nil
		}
		return g.emitField(raw, f.Kind == "tsField")

	case "string":
		if absent {
			return `""`, nil
		}
		var s string
		if err := json.Unmarshal(raw, &s); err != nil {
			return "", err
		}
		return strconv.Quote(s), nil

	case "int", "int64", "ptrInt":
		if absent {
			return "0", nil
		}
		var n int64
		if err := json.Unmarshal(raw, &n); err != nil {
			return "", err
		}
		return strconv.FormatInt(n, 10), nil

	case "bool", "ptrBool":
		if absent {
			return "false", nil
		}
		var v bool
		if err := json.Unmarshal(raw, &v); err != nil {
			return "", err
		}
		return strconv.FormatBool(v), nil

	case "stringList":
		if absent {
			return "nil", nil
		}
		items, err := stringSlice(raw)
		if err != nil {
			return "", err
		}
		return "[]string{" + strings.Join(quoteAll(items), ", ") + "}", nil

	case "keyValue":
		if absent {
			return "nil", nil
		}
		return g.emitKeyValue(raw)

	case "group":
		if absent {
			return "widget." + f.GroupType + "{}", nil
		}
		return g.emitGroup(f, raw)

	case "enum":
		if absent {
			// Absent enum sub-fields are skipped by emitGroup; a bare absent enum
			// field has no zero var to name, so this is unreachable in practice.
			return "", fmt.Errorf("cannot emit absent enum field %q", f.JSONKey)
		}
		return g.emitEnum(f, raw)

	case "color":
		// color always arrives via the variadic Color() method (emitMethodCalls),
		// never as a plain value; guarded here for completeness.
		opts, err := g.emitColorOptions(raw)
		if err != nil {
			return "", err
		}
		return "color.New(" + opts + ")", nil
	}
	return "", fmt.Errorf("no value emitter for kind %q", f.Kind)
}

// emitField renders one sql.SqlField from its wire form as the idiomatic
// constructor call (docs §2.1: kind ≡ which constructor produced the field).
func (g *generator) emitField(raw []byte, timestamped bool) (string, error) {
	g.imports[pkgSQL] = true
	var d fieldWire
	if err := json.Unmarshal(raw, &d); err != nil {
		return "", err
	}

	switch d.Kind {
	case "autoBucket":
		if d.Alias == "" || d.Alias == "time" {
			return fmt.Sprintf("sql.AutoBucket(%s)", strconv.Quote(d.Column)), nil
		}
		return fmt.Sprintf("sql.AutoBucketAs(%s, %s)", strconv.Quote(d.Column), strconv.Quote(d.Alias)), nil

	case "count":
		expr := "sql.Count()"
		if d.Alias != "" && d.Alias != "cnt" {
			expr += fmt.Sprintf(".WithAlias(%s)", strconv.Quote(d.Alias))
		}
		return expr, nil

	case "enum":
		// Enum() bakes `<field>::String`; recover <field> to emit sql.Enum(field).
		if field := strings.TrimSuffix(d.Definition, "::String"); field != d.Definition {
			expr := fmt.Sprintf("sql.Enum(%s)", strconv.Quote(field))
			if d.Alias != "" && d.Alias != field {
				expr += fmt.Sprintf(".WithAlias(%s)", strconv.Quote(d.Alias))
			}
			return expr, nil
		}
		// Non-standard definition: fall back to the generic expr emit below.
	}

	// expr / "" / unrecognised: a raw definition + alias.
	if timestamped {
		if d.Definition == d.Alias {
			if d.XBucketSizeMs > 0 {
				return fmt.Sprintf("sql.NewTimestampedFieldAlias(%s, %d)", strconv.Quote(d.Alias), d.XBucketSizeMs), nil
			}
			return fmt.Sprintf("sql.NewFieldAlias(%s)", strconv.Quote(d.Alias)), nil
		}
		return fmt.Sprintf("sql.TimestampField(%s, %s, %d)", strconv.Quote(d.Definition), strconv.Quote(d.Alias), d.XBucketSizeMs), nil
	}
	expr := fmt.Sprintf("sql.Field(%s)", strconv.Quote(d.Definition))
	if d.Alias != "" && d.Alias != d.Definition {
		expr += fmt.Sprintf(".WithAlias(%s)", strconv.Quote(d.Alias))
	}
	return expr, nil
}

// emitQueryable renders one sql.SqlQueryable from its wire form.
func (g *generator) emitQueryable(raw []byte) (string, error) {
	g.imports[pkgSQL] = true
	var q queryWire
	if err := json.Unmarshal(raw, &q); err != nil {
		return "", err
	}

	switch q.Kind {
	case "table":
		var opts []string
		if q.Table != "" {
			opts = append(opts, fmt.Sprintf("sql.From(%s)", strconv.Quote(q.Table)))
		}
		for _, w := range q.Where {
			opts = append(opts, fmt.Sprintf("sql.Where(%s)", strconv.Quote(w)))
		}
		for _, s := range q.Select {
			expr, err := g.emitField(s, false)
			if err != nil {
				return "", fmt.Errorf("select: %w", err)
			}
			opts = append(opts, fmt.Sprintf("sql.Select(%s)", expr))
		}
		for _, gb := range q.GroupBy {
			expr, err := g.emitField(gb, false)
			if err != nil {
				return "", fmt.Errorf("groupBy: %w", err)
			}
			opts = append(opts, fmt.Sprintf("sql.GroupBy(%s)", expr))
		}
		for _, ob := range q.OrderBy {
			expr, err := g.emitField(ob, false)
			if err != nil {
				return "", fmt.Errorf("orderBy: %w", err)
			}
			opts = append(opts, fmt.Sprintf("sql.OrderBy(%s)", expr))
		}
		if q.Limit > 0 {
			opts = append(opts, fmt.Sprintf("sql.Limit(%d)", q.Limit))
		}
		if q.FillStep != "" {
			opts = append(opts, fmt.Sprintf("sql.WithFill(%s)", strconv.Quote(q.FillStep)))
		}
		if q.Database != "" {
			opts = append(opts, fmt.Sprintf("sql.OnDatabase(%s)", strconv.Quote(q.Database)))
		}
		if q.SkipFilters {
			opts = append(opts, "sql.SkipFilters()")
		}
		if q.AutoBucketPlaceholder {
			opts = append(opts, "sql.AutoBucketPlaceholder()")
		}
		return "sql.New(" + joinOptsMultiline(opts) + ")", nil

	case "file":
		return g.emitFileOrString("sql.FromFile", "sql.FromFileWithoutFilters", q.Path, q), nil

	case "raw":
		return g.emitFileOrString("sql.FromString", "sql.FromStringWithoutFilters", q.Sql, q), nil
	}
	return "", fmt.Errorf("unknown queryable kind %q", q.Kind)
}

// emitFileOrString renders a file/inline query: the base constructor (picking
// the WithoutFilters variant when filters are skipped) plus a .With(...) for the
// options SqlFile/SqlString honour (Where, OnDatabase, AutoBucketPlaceholder).
func (g *generator) emitFileOrString(ctor, ctorNoFilters, content string, q queryWire) string {
	base := ctor
	if q.SkipFilters {
		base = ctorNoFilters
	}
	expr := fmt.Sprintf("%s(%s)", base, strconv.Quote(content))

	var opts []string
	for _, w := range q.Where {
		opts = append(opts, fmt.Sprintf("sql.Where(%s)", strconv.Quote(w)))
	}
	if q.Database != "" {
		opts = append(opts, fmt.Sprintf("sql.OnDatabase(%s)", strconv.Quote(q.Database)))
	}
	if q.AutoBucket {
		opts = append(opts, "sql.AutoBucketPlaceholder()")
	}
	if len(opts) > 0 {
		expr += ".With(" + joinOptsMultiline(opts) + ")"
	}
	return expr
}

// emitColorOptions renders the color.ColorScaleOption arguments for a .Color()
// call (defaults omitted so the output matches what the builder produced).
func (g *generator) emitColorOptions(raw []byte) (string, error) {
	g.imports[pkgColor] = true
	var c colorWire
	if err := json.Unmarshal(raw, &c); err != nil {
		return "", err
	}
	var opts []string
	if c.Legend {
		opts = append(opts, "color.ColorLegend(true)")
	}
	for i, v := range c.Domain {
		if i < len(c.Range) {
			opts = append(opts, fmt.Sprintf("color.ColorMapping(%s, %s)", strconv.Quote(v), strconv.Quote(c.Range[i])))
		}
	}
	if c.Unknown != "" && c.Unknown != defaultColorUnknown {
		opts = append(opts, fmt.Sprintf("color.ColorUnknown(%s)", strconv.Quote(c.Unknown)))
	}
	if c.Type != "" {
		opts = append(opts, fmt.Sprintf("color.ColorType(%s)", strconv.Quote(c.Type)))
	}
	if c.Scheme != "" {
		opts = append(opts, fmt.Sprintf("color.ColorScheme(%s)", strconv.Quote(c.Scheme)))
	}
	return joinOptsMultiline(opts), nil
}

// emitKeyValue renders a map[string]string literal with sorted keys.
func (g *generator) emitKeyValue(raw []byte) (string, error) {
	var m map[string]string
	if err := json.Unmarshal(raw, &m); err != nil {
		return "", err
	}
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var parts []string
	for _, k := range keys {
		parts = append(parts, fmt.Sprintf("%s: %s", strconv.Quote(k), strconv.Quote(m[k])))
	}
	return "map[string]string{" + strings.Join(parts, ", ") + "}", nil
}

// emitGroup renders a group as a struct literal (e.g. widget.StackOptions{...}),
// including only the sub-fields present in the wire form (absent → zero).
func (g *generator) emitGroup(f GocodeField, raw []byte) (string, error) {
	g.imports[pkgWidget] = true
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		return "", err
	}
	var parts []string
	for _, sf := range f.Fields {
		sub, ok := m[sf.JSONKey]
		if !ok || isNull(sub) {
			continue
		}
		expr, err := g.emitValue(sf, sub, false)
		if err != nil {
			return "", fmt.Errorf("group field %q: %w", sf.JSONKey, err)
		}
		parts = append(parts, fmt.Sprintf("%s: %s", upperFirst(sf.JSONKey), expr))
	}
	return "widget." + f.GroupType + "{" + strings.Join(parts, ", ") + "}", nil
}

// emitEnum renders an enum value as its package-level Go var (widget.OrderSum).
func (g *generator) emitEnum(f GocodeField, raw []byte) (string, error) {
	g.imports[pkgWidget] = true
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		return "", err
	}
	for _, ev := range f.EnumValues {
		if ev.Str == s {
			return "widget." + ev.VarName, nil
		}
	}
	return "", fmt.Errorf("unknown enum value %q for field %q", s, f.JSONKey)
}

// --- helpers ---------------------------------------------------------------

func joinOptsMultiline(opts []string) string {
	if len(opts) == 0 {
		return ""
	}
	// One option per line with trailing commas; gofmt keeps the layout.
	return "\n" + strings.Join(opts, ",\n") + ",\n"
}

func stringSlice(raw []byte) ([]string, error) {
	var out []string
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func quoteAll(items []string) []string {
	out := make([]string, len(items))
	for i, s := range items {
		out[i] = strconv.Quote(s)
	}
	return out
}

func isNull(b []byte) bool {
	return strings.TrimSpace(string(b)) == "null"
}

func upperFirst(s string) string {
	if s == "" {
		return s
	}
	r := []rune(s)
	r[0] = unicode.ToUpper(r[0])
	return string(r)
}
