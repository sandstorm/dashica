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

	data := struct {
		Widgets []widgetView
		Groups  []groupView
	}{}
	for _, w := range m.widgets {
		data.Widgets = append(data.Widgets, widgetView{
			Type:      w.TypeName,
			WireName:  w.WireName,
			Keys:      jsonKeys(w.Fields),
			Marshal:   marshalStmts(w.Fields),
			Unmarshal: unmarshalStmts(w.TypeName, w.Fields),
		})
	}
	for _, g := range groups {
		data.Groups = append(data.Groups, groupView{
			Type:      g.GroupType,
			Keys:      jsonKeys(g.Group),
			Marshal:   marshalStmts(g.Group),
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
	Type      string
	WireName  string
	Keys      []string
	Marshal   []string
	Unmarshal []string
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

// marshalStmts renders the guarded marshal block for each field.
func marshalStmts(fields []fieldInfo) []string {
	out := make([]string, 0, len(fields))
	for _, f := range fields {
		out = append(out, marshalStmt(f))
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
func marshalStmt(f fieldInfo) string {
	key := f.JSONKey
	set := func(guard, expr string) string {
		return fmt.Sprintf("if %s {\nif m[%q], err = %s; err != nil {\nreturn nil, err\n}\n}", guard, key, expr)
	}
	switch f.Category {
	case catQueryable:
		return set("r."+f.GoName+" != nil", "sql.MarshalQueryable(r."+f.GoName+")")
	case catField, catTsField:
		return set("r."+f.GoName+" != nil", "sql.MarshalField(r."+f.GoName+")")
	case catOptField:
		return set("r."+f.GoName+" != nil", "sql.MarshalField(*r."+f.GoName+")")
	case catString:
		return set(fmt.Sprintf("r.%s != \"\"", f.GoName), "json.Marshal(r."+f.GoName+")")
	case catInt, catInt64:
		return set(fmt.Sprintf("r.%s != 0", f.GoName), "json.Marshal(r."+f.GoName+")")
	case catBool:
		return set("r."+f.GoName, "json.Marshal(r."+f.GoName+")")
	case catEnum:
		// A bare enum field marshals as its inner string value.
		return set(fmt.Sprintf("r.%s.v != \"\"", f.GoName), "json.Marshal(r."+f.GoName+".v)")
	case catPtrInt, catPtrBool, catColor:
		return set("r."+f.GoName+" != nil", "json.Marshal(r."+f.GoName+")")
	case catKeyValue, catStringList, catChildrenList, catChildrenMap:
		return set(fmt.Sprintf("len(r.%s) > 0", f.GoName), "json.Marshal(r."+f.GoName+")")
	case catGroup:
		return set(fmt.Sprintf("r.%s != (%s{})", f.GoName, f.GroupType), "json.Marshal(r."+f.GoName+")")
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
		return head + fmt.Sprintf(
			"var f sql.SqlField\nif f, err = sql.UnmarshalField(raw); err != nil {\nreturn err\n}\nr.%s = &f\n}", f.GoName)
	case catEnum:
		return head + enumUnmarshal(typeName, f) + "\n}"
	default:
		// Everything else round-trips through encoding/json straight into the
		// (possibly pointer) field; nested types with their own JSON methods
		// (color.ColorScale, Widgets, WidgetsMap, group types) dispatch there.
		return head + fmt.Sprintf("if err = json.Unmarshal(raw, &r.%s); err != nil {\nreturn err\n}\n}", f.GoName)
	}
}

// enumUnmarshal validates a string against the known enum vars and assigns the
// matching package-level value (preserving the enum-safety idiom).
func enumUnmarshal(typeName string, f fieldInfo) string {
	var b strings.Builder
	b.WriteString("var v string\nif err = json.Unmarshal(raw, &v); err != nil {\nreturn err\n}\n")
	b.WriteString("switch v {\n")
	b.WriteString(fmt.Sprintf("case \"\":\nr.%s = %s{}\n", f.GoName, f.EnumType))
	for _, ev := range f.EnumOptions {
		b.WriteString(fmt.Sprintf("case %q:\nr.%s = %s\n", ev.Str, f.GoName, ev.VarName))
	}
	b.WriteString(fmt.Sprintf("default:\nreturn fmt.Errorf(%q, v)\n}", typeName+": unknown "+f.JSONKey+" %q"))
	return b.String()
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
