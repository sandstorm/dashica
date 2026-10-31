package main

import (
	"bytes"
	"fmt"
	"go/format"
	"os"
	"path/filepath"
	"strings"
	"text/template"
)

// emit renders the generated file (serializers for every widget + every group
// type) and writes it, gofmt'd, next to the widget sources.
//
// Emitter mechanics: stdlib text/template lays out the functions; the per-field
// branching (which varies by category) is computed in Go by marshalStmt /
// unmarshalStmt and injected as pre-rendered statements. go/format fixes all
// spacing, so the templates need not be whitespace-perfect. (See §4.5.)
func emit(m *model, outFile string) error {
	groups := collectGroups(m)

	gocode, err := gocodeJSONLiteral(m)
	if err != nil {
		return fmt.Errorf("gocode table: %w", err)
	}

	data := struct {
		Widgets     []widgetView
		Groups      []groupView
		Descriptors string
		Gocode      string
	}{
		Descriptors: descriptorLiteral(m),
		Gocode:      gocode,
	}
	for _, w := range m.widgets {
		data.Widgets = append(data.Widgets, widgetView{
			Type:          w.TypeName,
			WireName:      w.WireName,
			Keys:          jsonKeys(w.Fields),
			Marshal:       marshalStmts("r", "sql.MarshalField", w.Fields),
			Props:         marshalStmts("r", "sql.MarshalFieldProps", clientFields(w.Fields)),
			Computed:      w.ComputedType != "",
			Titled:        hasTitle(w.Fields),
			ComputedProps: marshalStmts("c", "sql.MarshalFieldProps", w.ComputedFields),
			Unmarshal:     unmarshalStmts(w.TypeName, w.Fields),
			Dimensions:    dimensionStmts(w.Fields),
		})
	}
	for _, g := range groups {
		data.Groups = append(data.Groups, groupView{
			Type:      g.GroupType,
			Keys:      jsonKeys(g.Group),
			Marshal:   marshalStmts("r", "sql.MarshalField", g.Group),
			Unmarshal: unmarshalStmts(g.GroupType, g.Group),
		})
	}

	var buf bytes.Buffer
	if err := fileTemplate.Execute(&buf, data); err != nil {
		return fmt.Errorf("render: %w", err)
	}
	src, err := format.Source(buf.Bytes())
	if err != nil {
		// Emit the unformatted source alongside the error to make debugging the
		// generator itself possible.
		return fmt.Errorf("gofmt generated source: %w\n---\n%s", err, numberLines(buf.String()))
	}

	path := filepath.Join(m.pkgDir, outFile)
	if err := os.WriteFile(path, src, 0o644); err != nil {
		return fmt.Errorf("write %s: %w", path, err)
	}
	return nil
}

type widgetView struct {
	Type     string
	WireName string
	Keys     []string
	Marshal  []string
	Props    []string
	// Computed: it has a computeProps; ComputedProps marshal what it returns.
	Computed      bool
	ComputedProps []string
	Unmarshal     []string
	// Dimensions append its dimension slots that are set; no dimensions() without one.
	Dimensions []string
	// Titled: it has a client field `title`, which widgetTitle returns.
	Titled bool
}

type groupView struct {
	Type      string
	Keys      []string
	Marshal   []string
	Unmarshal []string
}

// collectGroups returns each distinct group type used by any widget, once.
func collectGroups(m *model) []fieldInfo {
	seen := map[string]bool{}
	var out []fieldInfo
	for _, w := range m.widgets {
		for _, f := range w.Fields {
			if f.Category == catGroup && !seen[f.GroupType] {
				seen[f.GroupType] = true
				out = append(out, f)
			}
		}
	}
	return out
}

func jsonKeys(fields []fieldInfo) []string {
	out := make([]string, len(fields))
	for i, f := range fields {
		out[i] = f.JSONKey
	}
	return out
}

// clientFields are the fields tagged `dashica-gen:"client"`.
func clientFields(fields []fieldInfo) []fieldInfo {
	var out []fieldInfo
	for _, f := range fields {
		if f.Client {
			out = append(out, f)
		}
	}
	return out
}

// hasTitle is whether `fields` has the client field `title` (a chart's, a group's).
func hasTitle(fields []fieldInfo) bool {
	for _, f := range fields {
		if f.GoName == "title" && f.Client {
			return true
		}
	}
	return false
}

// propsFields are the fields in a widget's props in page.json: those tagged `dashica-gen:"client"`, then what its
// computeProps computes.
func propsFields(w widgetInfo) []fieldInfo {
	return append(clientFields(w.Fields), w.ComputedFields...)
}

// marshalStmts renders the guarded marshal block for each field of the struct `recv` ("r": the widget, "c": what
// its computeProps returned); `marshalField` serializes its SqlFields: sql.MarshalField all of a field (MarshalJSON,
// read by Explore), sql.MarshalFieldProps its alias without the definition (the props in page.json).
func marshalStmts(recv, marshalField string, fields []fieldInfo) []string {
	out := make([]string, 0, len(fields))
	for _, f := range fields {
		out = append(out, marshalStmt(recv, marshalField, f))
	}
	return out
}

// dimensionStmts append each slot tagged `role=dimension` that is set to `out`; a TimestampedField is a time axis,
// which interprets no filter.
func dimensionStmts(fields []fieldInfo) []string {
	var out []string
	for _, f := range fields {
		if f.Role != "dimension" {
			continue
		}
		switch f.Category {
		case catField:
			out = append(out, fmt.Sprintf("if r.%s != nil {\nout = append(out, r.%s)\n}", f.GoName, f.GoName))
		case catOptField:
			out = append(out, fmt.Sprintf("if r.%s != nil {\nout = append(out, *r.%s)\n}", f.GoName, f.GoName))
		}
	}
	return out
}

func unmarshalStmts(typeName string, fields []fieldInfo) []string {
	out := make([]string, 0, len(fields))
	for _, f := range fields {
		out = append(out, unmarshalStmt(typeName, f))
	}
	return out
}

// marshalStmt emits `if <nonzero> { m[key], err = <marshal>; ... }` for one
// field. The map is map[string]json.RawMessage, so a present key is always the
// field's own JSON; absent keys are the omit-when-empty case.
func marshalStmt(recv, marshalField string, f fieldInfo) string {
	v := recv + "." + f.GoName
	key := f.JSONKey
	set := func(guard, expr string) string {
		return fmt.Sprintf("if %s {\nif m[%q], err = %s; err != nil {\nreturn nil, err\n}\n}", guard, key, expr)
	}
	switch f.Category {
	case catQueryable:
		return set(v+" != nil", "sql.MarshalQueryable("+v+")")
	case catField, catTsField:
		return set(v+" != nil", marshalField+"("+v+")")
	case catOptField:
		return set(v+" != nil", marshalField+"(*"+v+")")
	case catString:
		return set(v+` != ""`, "json.Marshal("+v+")")
	case catInt, catInt64:
		return set(v+" != 0", "json.Marshal("+v+")")
	case catBool:
		return set(v, "json.Marshal("+v+")")
	case catEnum:
		// its MarshalJSON (zz_generated.enums.go) writes its value
		return set(v+" != ("+f.EnumType+"{})", "json.Marshal("+v+")")
	case catPtrInt, catPtrBool, catColor:
		return set(v+" != nil", "json.Marshal("+v+")")
	case catKeyValue, catStringList, catChildrenList, catChildrenMap:
		return set("len("+v+") > 0", "json.Marshal("+v+")")
	case catGroup:
		return set(v+" != ("+f.GroupType+"{})", "json.Marshal("+v+")")
	}
	panic("marshalStmt: unhandled category " + string(f.Category))
}

// unmarshalStmt emits `if raw, ok := m[key]; ok { ... }` for one field.
func unmarshalStmt(typeName string, f fieldInfo) string {
	key := f.JSONKey
	head := fmt.Sprintf("if raw, ok := m[%q]; ok {\n", key)
	switch f.Category {
	case catQueryable:
		return head + fmt.Sprintf("if r.%s, err = sql.UnmarshalQueryable(raw); err != nil {\nreturn err\n}\n}", f.GoName)
	case catTsField:
		return head + fmt.Sprintf(
			"var f sql.SqlField\nif f, err = sql.UnmarshalField(raw); err != nil {\nreturn err\n}\n"+
				"tf, isTs := f.(sql.TimestampedField)\nif !isTs {\nreturn fmt.Errorf(%q)\n}\nr.%s = tf\n}",
			typeName+": field "+f.JSONKey+" is not a timestamped field", f.GoName)
	case catField:
		return head + fmt.Sprintf("if r.%s, err = sql.UnmarshalField(raw); err != nil {\nreturn err\n}\n}", f.GoName)
	case catOptField:
		// JSON null → nil interface → leave the pointer nil. Guarding here (rather
		// than always taking &f) keeps `r.<field> != nil` a faithful "was set"
		// test, so Query's `if b.fill != nil` never derefs a nil interface.
		return head + fmt.Sprintf(
			"var f sql.SqlField\nif f, err = sql.UnmarshalField(raw); err != nil {\nreturn err\n}\nif f != nil {\nr.%s = &f\n}\n}", f.GoName)
	default:
		// Everything else round-trips through encoding/json straight into the
		// (possibly pointer) field; nested types with their own JSON methods
		// (color.ColorScale, Widgets, WidgetsMap, group types, enums) dispatch there.
		return head + fmt.Sprintf("if err = json.Unmarshal(raw, &r.%s); err != nil {\nreturn err\n}\n}", f.GoName)
	}
}

func numberLines(s string) string {
	var b strings.Builder
	for i, line := range strings.Split(s, "\n") {
		fmt.Fprintf(&b, "%4d\t%s\n", i+1, line)
	}
	return b.String()
}

var fileTemplate = template.Must(template.New("file").Parse(`// Code generated by dashica-gen; DO NOT EDIT.
package widget

import (
	"encoding/json"
	"fmt"

	"github.com/sandstorm/dashica/lib/dashboard/color"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
)

// silence unused imports when a build has no field of a given kind.
var (
	_ = json.Marshal
	_ = fmt.Errorf
	_ = color.New
	_ = sql.Field
)

{{range .Widgets}}
// --- {{.WireName}} ({{.Type}}) ---

func (r *{{.Type}}) MarshalJSON() ([]byte, error) {
	m := map[string]json.RawMessage{}
	var err error
	{{range .Marshal}}{{.}}
	{{end}}
	return json.Marshal(m)
}

// marshalProps is its props in page.json: the fields tagged ` + "`" + `dashica-gen:"client"` + "`" + `{{if .Computed}}, then what computeProps computes{{end}}.
func (r *{{.Type}}) marshalProps(ctx *rendering.DashboardContext) ([]byte, error) {
	m := map[string]json.RawMessage{}
	var err error
	_ = err
	{{range .Props}}{{.}}
	{{end}}{{if .Computed}}c, err := r.computeProps(ctx)
	if err != nil {
		return nil, err
	}
	{{range .ComputedProps}}{{.}}
	{{end}}{{else}}_ = ctx
	{{end}}return json.Marshal(m)
}
{{if .Titled}}
// widgetTitle is its title, as the page's outline names it.
func (r *{{.Type}}) widgetTitle() string { return r.title }
{{end}}{{if .Dimensions}}
// dimensions are its slots tagged ` + "`" + `role=dimension` + "`" + ` that are set: its own fields, those holding categories the ones it makes pills of (/pill).
func (r *{{.Type}}) dimensions() []sql.SqlField {
	var out []sql.SqlField
	{{range .Dimensions}}{{.}}
	{{end}}return out
}
{{end}}
func (r *{{.Type}}) UnmarshalJSON(b []byte) error {
	var m map[string]json.RawMessage
	if err := json.Unmarshal(b, &m); err != nil {
		return err
	}
	for k := range m {
		switch k {
		{{range .Keys}}case {{printf "%q" .}}:
		{{end}}default:
			return fmt.Errorf("{{.WireName}}: unknown field %q", k)
		}
	}
	var err error
	_ = err
	{{range .Unmarshal}}{{.}}
	{{end}}
	return nil
}
{{end}}

// widgetDescriptors is the editor form model for every registered widget type,
// keyed by wire name. Served by /explore/api/formmodel; types in formmodel.go.
var widgetDescriptors = map[string]WidgetDescriptor{
{{.Descriptors}}}

// WidgetDescriptors returns the editor descriptor for every registered widget
// type, keyed by wire name.
func WidgetDescriptors() map[string]WidgetDescriptor { return widgetDescriptors }

// widgetGocodeJSON is the Go-code-generation table for every registered widget
// type, keyed by wire name, as an opaque JSON blob. Go-code generation is an
// Explore concern, so the widget package carries only the serialized data — the
// model types and the emitter live in lib/explore, which unmarshals this at
// init. See docs §4 Step 4.
const widgetGocodeJSON = {{.Gocode}}

// WidgetGocodeJSON returns the Go-code-generation table as a JSON blob, decoded
// by lib/explore.
func WidgetGocodeJSON() string { return widgetGocodeJSON }

{{range .Groups}}
// --- group {{.Type}} ---

func (r {{.Type}}) MarshalJSON() ([]byte, error) {
	m := map[string]json.RawMessage{}
	var err error
	{{range .Marshal}}{{.}}
	{{end}}
	return json.Marshal(m)
}

func (r *{{.Type}}) UnmarshalJSON(b []byte) error {
	var m map[string]json.RawMessage
	if err := json.Unmarshal(b, &m); err != nil {
		return err
	}
	for k := range m {
		switch k {
		{{range .Keys}}case {{printf "%q" .}}:
		{{end}}default:
			return fmt.Errorf("{{.Type}}: unknown field %q", k)
		}
	}
	var err error
	_ = err
	{{range .Unmarshal}}{{.}}
	{{end}}
	return nil
}
{{end}}
`))
