package main

import (
	"fmt"
	"go/ast"
	"go/token"
	"go/types"
	"reflect"
	"sort"
	"strings"
	"unicode"

	"golang.org/x/tools/go/packages"
)

// loadModel loads the target package (given as a go/packages pattern, e.g. "."
// or an import path), discovers the registered widget types from the registry
// init() calls, and classifies every field of every widget.
func loadModel(pattern string) (*model, error) {
	cfg := &packages.Config{
		Mode: packages.NeedName | packages.NeedFiles | packages.NeedSyntax |
			packages.NeedTypes | packages.NeedTypesInfo | packages.NeedDeps |
			packages.NeedImports,
	}
	pkgs, err := packages.Load(cfg, pattern)
	if err != nil {
		return nil, fmt.Errorf("load %s: %w", pattern, err)
	}
	if packages.PrintErrors(pkgs) > 0 {
		return nil, fmt.Errorf("package %s has errors", pattern)
	}
	if len(pkgs) != 1 {
		return nil, fmt.Errorf("expected exactly one package for %q, got %d", pattern, len(pkgs))
	}
	pkg := pkgs[0]

	m := &model{
		pkgDir: pkgDir(pkg),
		enums:  map[string][]enumValue{},
	}

	// Enum types + their package-level values (StackOrder/StackOffset).
	enumTypes := findEnumTypes(pkg)
	m.enums = findEnumValues(pkg, enumTypes)

	// Doc comments per (struct, field), harvested from the syntax trees.
	docs := harvestDocs(pkg)

	// Registered widgets, in wire-name order.
	regs, err := findRegistrations(pkg)
	if err != nil {
		return nil, err
	}

	for _, r := range regs {
		wi, err := classifyWidget(pkg, r, docs, enumTypes, m.enums)
		if err != nil {
			return nil, fmt.Errorf("widget %q (%s): %w", r.wireName, r.typeName, err)
		}
		m.widgets = append(m.widgets, *wi)
	}
	sort.Slice(m.widgets, func(i, j int) bool { return m.widgets[i].WireName < m.widgets[j].WireName })
	return m, nil
}

func pkgDir(pkg *packages.Package) string {
	if len(pkg.GoFiles) == 0 {
		return "."
	}
	return dirOf(pkg.GoFiles[0])
}

func dirOf(file string) string {
	i := strings.LastIndexByte(file, '/')
	if i < 0 {
		return "."
	}
	return file[:i]
}

// registration is one Register("wire", func() WidgetDefinition { return NewX(...) }) call.
type registration struct {
	wireName string
	typeName string       // "TimeBar"
	named    *types.Named // the widget's named type
}

// findRegistrations scans for Register(<string>, <funclit>) calls in the widget
// package's init() and resolves each factory's return type. This mirrors the
// runtime registry exactly, so there is no second hand-maintained widget list.
func findRegistrations(pkg *packages.Package) ([]registration, error) {
	var out []registration
	for _, file := range pkg.Syntax {
		ast.Inspect(file, func(n ast.Node) bool {
			call, ok := n.(*ast.CallExpr)
			if !ok {
				return true
			}
			id, ok := call.Fun.(*ast.Ident)
			if !ok || id.Name != "Register" || len(call.Args) != 2 {
				return true
			}
			lit, ok := call.Args[0].(*ast.BasicLit)
			if !ok || lit.Kind != token.STRING {
				return true
			}
			wire := strings.Trim(lit.Value, `"`)
			named := factoryReturnType(pkg, call.Args[1])
			if named == nil {
				return true
			}
			out = append(out, registration{wireName: wire, typeName: named.Obj().Name(), named: named})
			return true
		})
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("no Register(...) calls found in %s", pkg.PkgPath)
	}
	return out, nil
}

// factoryReturnType resolves the widget *types.Named produced by a factory
// func literal `func() WidgetDefinition { return NewX(...) }`.
func factoryReturnType(pkg *packages.Package, arg ast.Expr) *types.Named {
	fl, ok := arg.(*ast.FuncLit)
	if !ok {
		return nil
	}
	var named *types.Named
	ast.Inspect(fl.Body, func(n ast.Node) bool {
		ret, ok := n.(*ast.ReturnStmt)
		if !ok || len(ret.Results) != 1 {
			return true
		}
		t := pkg.TypesInfo.TypeOf(ret.Results[0])
		named = derefNamed(t)
		return false
	})
	return named
}

// derefNamed unwraps *T -> T and returns the underlying *types.Named, or nil.
func derefNamed(t types.Type) *types.Named {
	if p, ok := t.(*types.Pointer); ok {
		t = p.Elem()
	}
	if n, ok := t.(*types.Named); ok {
		return n
	}
	return nil
}

// findEnumTypes returns the set of type names in the package that are the
// enum-safety idiom `struct{ v string }` (StackOrder, StackOffset).
func findEnumTypes(pkg *packages.Package) map[string]bool {
	out := map[string]bool{}
	scope := pkg.Types.Scope()
	for _, name := range scope.Names() {
		tn, ok := scope.Lookup(name).(*types.TypeName)
		if !ok {
			continue
		}
		named, ok := tn.Type().(*types.Named)
		if !ok {
			continue
		}
		st, ok := named.Underlying().(*types.Struct)
		if !ok || st.NumFields() != 1 {
			continue
		}
		f := st.Field(0)
		if !f.Exported() && f.Name() == "v" && isBasic(f.Type(), types.String) {
			out[name] = true
		}
	}
	return out
}

// findEnumValues collects, per enum type, the package-level vars of that type
// and the string literal each carries (in declaration order).
func findEnumValues(pkg *packages.Package, enumTypes map[string]bool) map[string][]enumValue {
	out := map[string][]enumValue{}
	for _, file := range pkg.Syntax {
		for _, decl := range file.Decls {
			gd, ok := decl.(*ast.GenDecl)
			if !ok || gd.Tok != token.VAR {
				continue
			}
			for _, spec := range gd.Specs {
				vs, ok := spec.(*ast.ValueSpec)
				if !ok {
					continue
				}
				for i, nameIdent := range vs.Names {
					if i >= len(vs.Values) {
						continue
					}
					cl, ok := vs.Values[i].(*ast.CompositeLit)
					if !ok {
						continue
					}
					tIdent, ok := cl.Type.(*ast.Ident)
					if !ok || !enumTypes[tIdent.Name] {
						continue
					}
					if len(cl.Elts) != 1 {
						continue
					}
					blit, ok := cl.Elts[0].(*ast.BasicLit)
					if !ok || blit.Kind != token.STRING {
						continue
					}
					out[tIdent.Name] = append(out[tIdent.Name], enumValue{
						VarName: nameIdent.Name,
						Str:     strings.Trim(blit.Value, `"`),
					})
				}
			}
		}
	}
	return out
}

// harvestDocs maps "TypeName.fieldName" -> trimmed doc comment.
func harvestDocs(pkg *packages.Package) map[string]string {
	out := map[string]string{}
	for _, file := range pkg.Syntax {
		for _, decl := range file.Decls {
			gd, ok := decl.(*ast.GenDecl)
			if !ok || gd.Tok != token.TYPE {
				continue
			}
			for _, spec := range gd.Specs {
				ts, ok := spec.(*ast.TypeSpec)
				if !ok {
					continue
				}
				st, ok := ts.Type.(*ast.StructType)
				if !ok {
					continue
				}
				for _, f := range st.Fields.List {
					doc := strings.TrimSpace(f.Doc.Text())
					if doc == "" {
						doc = strings.TrimSpace(f.Comment.Text())
					}
					if doc == "" {
						continue
					}
					for _, nm := range f.Names {
						out[ts.Name.Name+"."+nm.Name] = doc
					}
				}
			}
		}
	}
	return out
}

// classifyWidget builds a widgetInfo for one registered widget.
func classifyWidget(pkg *packages.Package, r registration, docs map[string]string, enumTypes map[string]bool, enums map[string][]enumValue) (*widgetInfo, error) {
	st, ok := r.named.Underlying().(*types.Struct)
	if !ok {
		return nil, fmt.Errorf("underlying type is not a struct")
	}
	wi := &widgetInfo{
		WireName: r.wireName,
		TypeName: r.typeName,
		Title:    camelSplit(r.typeName),
	}
	methods := methodSet(r.named)

	for i := 0; i < st.NumFields(); i++ {
		f := st.Field(i)
		tag := st.Tag(i)
		fi, skip, err := classifyField(pkg, r.typeName, f, tag, docs, enumTypes, enums, methods)
		if err != nil {
			return nil, fmt.Errorf("field %q: %w", f.Name(), err)
		}
		if skip {
			continue
		}
		wi.Fields = append(wi.Fields, *fi)
	}
	return wi, nil
}

// classifyField classifies one struct field. Returns (info, skip, error).
func classifyField(pkg *packages.Package, typeName string, f *types.Var, tag string, docs map[string]string, enumTypes map[string]bool, enums map[string][]enumValue, methods map[string]bool) (*fieldInfo, bool, error) {
	name := f.Name()

	// The internal render-time id is never serialized/edited/emitted.
	if name == "id" && isBasic(f.Type(), types.String) {
		return nil, true, nil
	}
	dashicaTag := parseDashicaTag(tag)
	if dashicaTag["skip"] == "true" {
		return nil, true, nil
	}

	fi := &fieldInfo{
		GoName:  name,
		JSONKey: name,
		Doc:     docs[typeName+"."+name],
	}
	if jk := dashicaTag["json"]; jk != "" {
		fi.JSONKey = jk
	}

	cat, sub, err := categoryOf(pkg, f.Type(), enumTypes, enums)
	if err != nil {
		return nil, false, err
	}
	fi.Category = cat
	fi.Group = sub.group
	fi.GroupType = sub.groupType
	fi.EnumType = sub.enumType
	fi.EnumOptions = sub.enumOptions
	fi.Required = cat == catQueryable || cat == catField || cat == catTsField

	// gocode mapping (consumed in Phase 3): identity title-case unless overridden.
	fi.IsCtorArg = cat == catQueryable
	if !fi.IsCtorArg {
		method := upperFirst(name)
		if ov := dashicaTag["method"]; ov != "" {
			method = ov
		}
		fi.GoMethod = method
		fi.MethodExists = methods[method]
	}
	return fi, false, nil
}

// subInfo carries the extra data a group/enum field needs.
type subInfo struct {
	group       []fieldInfo
	groupType   string
	enumType    string
	enumOptions []enumValue
}

// categoryOf maps a Go type to a fieldCategory (the closed supported set).
func categoryOf(pkg *packages.Package, t types.Type, enumTypes map[string]bool, enums map[string][]enumValue) (fieldCategory, subInfo, error) {
	var sub subInfo

	// Pointers: *int, *bool, *color.ColorScale, *sql.SqlField.
	if p, ok := t.(*types.Pointer); ok {
		switch {
		case isBasic(p.Elem(), types.Int):
			return catPtrInt, sub, nil
		case isBasic(p.Elem(), types.Bool):
			return catPtrBool, sub, nil
		case isNamedFrom(p.Elem(), "color", "ColorScale"):
			return catColor, sub, nil
		case isSqlInterface(p.Elem(), "SqlField"):
			return catOptField, sub, nil
		}
		return "", sub, fmt.Errorf("unsupported pointer type %s", t)
	}

	// sql interfaces.
	if isSqlInterface(t, "SqlQueryable") {
		return catQueryable, sub, nil
	}
	if isSqlInterface(t, "TimestampedField") {
		return catTsField, sub, nil
	}
	if isSqlInterface(t, "SqlField") {
		return catField, sub, nil
	}

	// Basics.
	if isBasic(t, types.String) {
		return catString, sub, nil
	}
	if isBasic(t, types.Int) {
		return catInt, sub, nil
	}
	if isBasic(t, types.Int64) {
		return catInt64, sub, nil
	}
	if isBasic(t, types.Bool) {
		return catBool, sub, nil
	}

	// map[string]string.
	if mp, ok := t.(*types.Map); ok {
		if isBasic(mp.Key(), types.String) && isBasic(mp.Elem(), types.String) {
			return catKeyValue, sub, nil
		}
		return "", sub, fmt.Errorf("unsupported map type %s", t)
	}

	// []string.
	if sl, ok := t.(*types.Slice); ok {
		if isBasic(sl.Elem(), types.String) {
			return catStringList, sub, nil
		}
		return "", sub, fmt.Errorf("unsupported slice type %s", t)
	}

	// Named types in the widget package: Widgets, WidgetsMap, enum types, groups.
	if n, ok := t.(*types.Named); ok {
		obj := n.Obj()
		switch obj.Name() {
		case "Widgets":
			return catChildrenList, sub, nil
		case "WidgetsMap":
			return catChildrenMap, sub, nil
		}
		if enumTypes[obj.Name()] {
			sub.enumType = obj.Name()
			sub.enumOptions = enums[obj.Name()]
			return catEnum, sub, nil
		}
		// A named struct with all-exported fields is a group (e.g. StackOptions).
		if st, ok := n.Underlying().(*types.Struct); ok {
			grp, err := classifyGroup(pkg, obj.Name(), st, enumTypes, enums)
			if err != nil {
				return "", sub, err
			}
			sub.group = grp
			sub.groupType = obj.Name()
			return catGroup, sub, nil
		}
	}

	return "", sub, fmt.Errorf("unsupported type %s (add a serializer case + editor kind, or //dashica:skip)", t)
}

func classifyGroup(pkg *packages.Package, typeName string, st *types.Struct, enumTypes map[string]bool, enums map[string][]enumValue) ([]fieldInfo, error) {
	var out []fieldInfo
	for i := 0; i < st.NumFields(); i++ {
		f := st.Field(i)
		if !f.Exported() {
			return nil, fmt.Errorf("group %s has unexported field %q", typeName, f.Name())
		}
		cat, sub, err := categoryOf(pkg, f.Type(), enumTypes, enums)
		if err != nil {
			return nil, fmt.Errorf("group %s field %q: %w", typeName, f.Name(), err)
		}
		out = append(out, fieldInfo{
			GoName:      f.Name(),
			JSONKey:     lowerFirst(f.Name()),
			Category:    cat,
			EnumType:    sub.enumType,
			EnumOptions: sub.enumOptions,
			Group:       sub.group,
		})
	}
	return out, nil
}

func methodSet(named *types.Named) map[string]bool {
	out := map[string]bool{}
	// Methods on the pointer receiver (builder methods are pointer-receiver).
	ptr := types.NewPointer(named)
	ms := types.NewMethodSet(ptr)
	for i := 0; i < ms.Len(); i++ {
		out[ms.At(i).Obj().Name()] = true
	}
	return out
}

// --- small type predicates -------------------------------------------------

func isBasic(t types.Type, kind types.BasicKind) bool {
	b, ok := t.Underlying().(*types.Basic)
	return ok && b.Kind() == kind
}

func isNamedFrom(t types.Type, pkgName, typeName string) bool {
	n, ok := t.(*types.Named)
	if !ok {
		return false
	}
	obj := n.Obj()
	return obj.Name() == typeName && obj.Pkg() != nil && obj.Pkg().Name() == pkgName
}

// isSqlInterface matches sql.<name> (interface types live in the sql package).
func isSqlInterface(t types.Type, name string) bool {
	return isNamedFrom(t, "sql", name)
}

func parseDashicaTag(tag string) map[string]string {
	out := map[string]string{}
	st := reflect.StructTag(tag).Get("dashica-gen")
	if st == "" {
		return out
	}
	for _, part := range strings.Split(st, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if k, v, ok := strings.Cut(part, "="); ok {
			out[strings.TrimSpace(k)] = strings.TrimSpace(v)
		} else {
			out[part] = "true"
		}
	}
	return out
}

func camelSplit(s string) string {
	var b strings.Builder
	for i, r := range s {
		if i > 0 && unicode.IsUpper(r) {
			b.WriteByte(' ')
		}
		b.WriteRune(r)
	}
	return b.String()
}

func lowerFirst(s string) string {
	if s == "" {
		return s
	}
	r := []rune(s)
	r[0] = unicode.ToLower(r[0])
	return string(r)
}

func upperFirst(s string) string {
	if s == "" {
		return s
	}
	r := []rune(s)
	r[0] = unicode.ToUpper(r[0])
	return string(r)
}
