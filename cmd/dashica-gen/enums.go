package main

import (
	"bytes"
	"fmt"
	"go/ast"
	"go/format"
	"go/token"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"text/template"

	"golang.org/x/tools/go/packages"
)

// emitEnums writes zz_generated.enums.go into the package of `pattern`: per enum String, GoString, MarshalJSON and
// UnmarshalJSON, the last refusing a value that is none of its values.
func emitEnums(pattern string) error {
	// the syntax only (see isEnumShape)
	pkgs, err := packages.Load(&packages.Config{Mode: packages.NeedName | packages.NeedFiles | packages.NeedSyntax}, pattern)
	if err != nil {
		return fmt.Errorf("load %s: %w", pattern, err)
	}
	if packages.PrintErrors(pkgs) > 0 {
		return fmt.Errorf("package %s has errors", pattern)
	}
	if len(pkgs) != 1 {
		return fmt.Errorf("expected exactly one package for %q, got %d", pattern, len(pkgs))
	}
	pkg := pkgs[0]
	enums, err := findEnums(pkg)
	if err != nil {
		return err
	}
	var names []string
	for name := range enums {
		names = append(names, name)
	}
	sort.Strings(names)
	var sorted []enumInfo
	for _, name := range names {
		sorted = append(sorted, enums[name])
	}
	var buf bytes.Buffer
	if err := enumsTemplate.Execute(&buf, struct {
		Pkg   string
		Enums []enumInfo
	}{pkg.Name, sorted}); err != nil {
		return err
	}
	src, err := format.Source(buf.Bytes())
	if err != nil {
		return fmt.Errorf("format: %w\n%s", err, buf.String())
	}
	return os.WriteFile(filepath.Join(pkgDir(pkg), "zz_generated.enums.go"), src, 0o644)
}

// enumAnnotation marks a type as an enum: `struct{ v string }` with its values as package-level vars
// (`var OrderSum = StackOrder{"sum"}`), so a value outside them does not compile.
const enumAnnotation = "//dashicagen:enum"

// enumInfo is a type annotated //dashicagen:enum and its values, in declaration order.
type enumInfo struct {
	PkgPath  string // "github.com/sandstorm/dashica/lib/dashboard/color"
	PkgName  string // "color"
	TypeName string // "ScaleType"
	Values   []enumValue
}

// findEnums are the enums of `pkg`, by type name. A type annotated //dashicagen:enum must be `struct{ v string }` with
// at least one value; a `struct{ v string }` without the annotation is refused too, so every enum says it is one.
func findEnums(pkg *packages.Package) (map[string]enumInfo, error) {
	out := map[string]enumInfo{}
	for _, file := range pkg.Syntax {
		for _, decl := range file.Decls {
			gd, ok := decl.(*ast.GenDecl)
			if !ok || gd.Tok != token.TYPE {
				continue
			}
			for _, spec := range gd.Specs {
				ts := spec.(*ast.TypeSpec)
				annotated := hasAnnotation(ts.Doc) || (len(gd.Specs) == 1 && hasAnnotation(gd.Doc))
				shaped := isEnumShape(ts)
				switch {
				case annotated && !shaped:
					return nil, fmt.Errorf("%s.%s is annotated %s but is no struct{ v string }", pkg.Name, ts.Name.Name, enumAnnotation)
				case shaped && !annotated:
					return nil, fmt.Errorf("%s.%s is a struct{ v string }: annotate it %s", pkg.Name, ts.Name.Name, enumAnnotation)
				case annotated:
					out[ts.Name.Name] = enumInfo{PkgPath: pkg.PkgPath, PkgName: pkg.Name, TypeName: ts.Name.Name}
				}
			}
		}
	}
	for _, file := range pkg.Syntax {
		for _, decl := range file.Decls {
			gd, ok := decl.(*ast.GenDecl)
			if !ok || gd.Tok != token.VAR {
				continue
			}
			for _, spec := range gd.Specs {
				vs := spec.(*ast.ValueSpec)
				for i, name := range vs.Names {
					if i >= len(vs.Values) {
						continue
					}
					typeName, str, ok := enumLiteral(vs.Values[i])
					if e, isEnum := out[typeName]; ok && isEnum {
						e.Values = append(e.Values, enumValue{VarName: name.Name, Str: str})
						out[typeName] = e
					}
				}
			}
		}
	}
	for name, e := range out {
		if len(e.Values) == 0 {
			return nil, fmt.Errorf("%s.%s has no values: declare them as var X = %s{\"…\"}", pkg.Name, name, name)
		}
	}
	return out, nil
}

func hasAnnotation(doc *ast.CommentGroup) bool {
	if doc == nil {
		return false
	}
	for _, c := range doc.List {
		if strings.TrimSpace(c.Text) == enumAnnotation {
			return true
		}
	}
	return false
}

// isEnumShape: `ts` declares `struct{ v string }`. It reads the syntax only, so -enums runs on a package that does
// not compile without its zz_generated.enums.go (one calling String() on its own enum).
func isEnumShape(ts *ast.TypeSpec) bool {
	st, ok := ts.Type.(*ast.StructType)
	if !ok || ts.Assign.IsValid() || ts.TypeParams != nil || len(st.Fields.List) != 1 {
		return false
	}
	field := st.Fields.List[0]
	typ, ok := field.Type.(*ast.Ident)
	return len(field.Names) == 1 && field.Names[0].Name == "v" && ok && typ.Name == "string"
}

// enumLiteral is the type and string of `T{"…"}`.
func enumLiteral(expr ast.Expr) (string, string, bool) {
	cl, ok := expr.(*ast.CompositeLit)
	if !ok || len(cl.Elts) != 1 {
		return "", "", false
	}
	typeIdent, ok := cl.Type.(*ast.Ident)
	if !ok {
		return "", "", false
	}
	lit, ok := cl.Elts[0].(*ast.BasicLit)
	if !ok || lit.Kind != token.STRING {
		return "", "", false
	}
	return typeIdent.Name, strings.Trim(lit.Value, `"`), true
}

var enumsTemplate = template.Must(template.New("enums").Parse(`// Code generated by dashica-gen -enums; DO NOT EDIT.
package {{.Pkg}}

import (
	"encoding/json"
	"fmt"
)
{{range $e := .Enums}}
// String is its value ("{{(index $e.Values 0).Str}}").
func (e {{$e.TypeName}}) String() string { return e.v }

// GoString is it as Go code ({{$e.PkgName}}.{{(index $e.Values 0).VarName}}), for the Go code Explore writes.
func (e {{$e.TypeName}}) GoString() string {
	switch e {
	{{- range $e.Values}}
	case {{.VarName}}:
		return "{{$e.PkgName}}.{{.VarName}}"
	{{- end}}
	}
	return "{{$e.PkgName}}.{{$e.TypeName}}{}"
}

func (e {{$e.TypeName}}) MarshalJSON() ([]byte, error) { return json.Marshal(e.v) }

func (e *{{$e.TypeName}}) UnmarshalJSON(b []byte) error {
	var v string
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	switch v {
	case "":
		*e = {{$e.TypeName}}{}
	{{- range $e.Values}}
	case "{{.Str}}":
		*e = {{.VarName}}
	{{- end}}
	default:
		return fmt.Errorf("unknown {{$e.TypeName}} %q", v)
	}
	return nil
}
{{end}}`))
