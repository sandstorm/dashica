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
		enums:  map[string]enumInfo{},
	}

	// The enums of the widget package and of the packages of this module it imports (color.Scheme).
	if err := collectEnums(pkg, m.enums); err != nil {
		return nil, err
	}

	// Doc comments per (struct, field), harvested from the syntax trees.
	docs := harvestDocs(pkg)

	// Registered widgets, in wire-name order.
	regs, err := findRegistrations(pkg)
	if err != nil {
		return nil, err
	}

	for _, r := range regs {
		wi, err := classifyWidget(pkg, r, docs, m.enums)
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

// registration is one Register("wire", Category, func() WidgetDefinition { return NewX(...) }) call.
type registration struct {
	wireName string
	category string       // the WidgetCategory var: "CategoryChart" | "CategoryParameter" | "CategoryContainer"
	typeName string       // "TimeBar"
	ctorName string       // factory function called in the funclit, e.g. "NewTimeBar"
	named    *types.Named // the widget's named type
}

// findRegistrations scans for Register(<string>, <WidgetCategory>, <funclit>)
// calls in the widget package's init(), resolving each factory's return type and
// the name of its category var. This mirrors the runtime registry
// exactly, so there is no second hand-maintained widget list.
func findRegistrations(pkg *packages.Package) ([]registration, error) {
	var out []registration
	for _, file := range pkg.Syntax {
		ast.Inspect(file, func(n ast.Node) bool {
			call, ok := n.(*ast.CallExpr)
			if !ok {
				return true
			}
			id, ok := call.Fun.(*ast.Ident)
			if !ok || id.Name != "Register" || len(call.Args) != 3 {
				return true
			}
			lit, ok := call.Args[0].(*ast.BasicLit)
			if !ok || lit.Kind != token.STRING {
				return true
			}
			wire := strings.Trim(lit.Value, `"`)
			category := categoryVar(pkg, call.Args[1])
			if category == "" {
				return true
			}
			named, ctorName := factoryReturnType(pkg, call.Args[2])
			if named == nil {
				return true
			}
			out = append(out, registration{wireName: wire, category: category, typeName: named.Obj().Name(), ctorName: ctorName, named: named})
			return true
		})
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("no Register(...) calls found in %s", pkg.PkgPath)
	}
	return out, nil
}

// categoryVar is the name of the WidgetCategory var `expr` names (CategoryChart), or "" if it names none.
func categoryVar(pkg *packages.Package, expr ast.Expr) string {
	id, ok := expr.(*ast.Ident)
	if !ok {
		return ""
	}
	v, ok := pkg.TypesInfo.Uses[id].(*types.Var)
	if !ok {
		return ""
	}
	if named, ok := v.Type().(*types.Named); !ok || named.Obj().Name() != "WidgetCategory" {
		return ""
	}
	return v.Name()
}

// factoryReturnType resolves the widget *types.Named produced by a factory
// func literal `func() WidgetDefinition { return NewX(...) }`, plus the name of
// the constructor function called (NewX) so the gocode emitter can reproduce it.
func factoryReturnType(pkg *packages.Package, arg ast.Expr) (*types.Named, string) {
	fl, ok := arg.(*ast.FuncLit)
	if !ok {
		return nil, ""
	}
	var named *types.Named
	var ctorName string
	ast.Inspect(fl.Body, func(n ast.Node) bool {
		ret, ok := n.(*ast.ReturnStmt)
		if !ok || len(ret.Results) != 1 {
			return true
		}
		t := pkg.TypesInfo.TypeOf(ret.Results[0])
		named = derefNamed(t)
		if call, ok := ret.Results[0].(*ast.CallExpr); ok {
			if id, ok := call.Fun.(*ast.Ident); ok {
				ctorName = id.Name
			}
		}
		return false
	})
	return named, ctorName
}

// constructorArgs resolves the widget constructor `ctorName` and returns, in
// parameter order, the struct field each parameter is assigned to in the
// constructor's `return &T{...}` composite literal. Matching by the composite
// literal (not by parameter name) is robust to renamed parameters — e.g.
// NewBarHorizontal(sqlq sql.SqlQueryable) assigns sqlq to the `sql` field. A
// parameter not assigned to any field (a default computed inline) yields "" and
// is skipped as a positional arg the emitter cannot reproduce, which is a hard
// error surfaced at classification time.
func constructorArgs(pkg *packages.Package, ctorName string) []string {
	if ctorName == "" {
		return nil
	}
	fn := findFuncDecl(pkg, ctorName)
	if fn == nil || fn.Type.Params == nil {
		return nil
	}

	// Map each parameter identifier to the struct field it is assigned to in the
	// returned composite literal.
	paramToField := map[string]string{}
	ast.Inspect(fn.Body, func(n ast.Node) bool {
		cl, ok := n.(*ast.CompositeLit)
		if !ok {
			return true
		}
		for _, elt := range cl.Elts {
			kv, ok := elt.(*ast.KeyValueExpr)
			if !ok {
				continue
			}
			key, ok := kv.Key.(*ast.Ident)
			if !ok {
				continue
			}
			if val, ok := kv.Value.(*ast.Ident); ok {
				paramToField[val.Name] = key.Name
			}
		}
		return true
	})

	var fields []string
	for _, p := range fn.Type.Params.List {
		for _, name := range p.Names {
			fields = append(fields, paramToField[name.Name]) // "" if not assigned to a field
		}
	}
	return fields
}

// findFuncDecl returns the top-level function declaration named `name` in the
// package (no receiver), or nil.
func findFuncDecl(pkg *packages.Package, name string) *ast.FuncDecl {
	for _, file := range pkg.Syntax {
		for _, decl := range file.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if ok && fn.Recv == nil && fn.Name.Name == name {
				return fn
			}
		}
	}
	return nil
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
func classifyWidget(pkg *packages.Package, r registration, docs map[string]string, enums map[string]enumInfo) (*widgetInfo, error) {
	st, ok := r.named.Underlying().(*types.Struct)
	if !ok {
		return nil, fmt.Errorf("underlying type is not a struct")
	}
	wi := &widgetInfo{
		WireName:    r.wireName,
		TypeName:    r.typeName,
		Title:       camelSplit(r.typeName),
		Category:    r.category,
		Constructor: r.ctorName,
	}
	methods := methodSet(r.named)

	// Constructor argument fields, in parameter order → field-name → position.
	ctorArgFields := constructorArgs(pkg, r.ctorName)
	ctorOrder := map[string]int{}
	for i, field := range ctorArgFields {
		if field == "" {
			return nil, fmt.Errorf("constructor %s parameter %d is not assigned to a struct field, so gocode cannot reproduce the call; give the parameter the field's name or add a builder method", r.ctorName, i)
		}
		ctorOrder[field] = i
	}

	for i := 0; i < st.NumFields(); i++ {
		f := st.Field(i)
		tag := st.Tag(i)
		fi, skip, err := classifyField(pkg, r.typeName, f, tag, docs, enums, methods, ctorOrder)
		if err != nil {
			return nil, fmt.Errorf("field %q: %w", f.Name(), err)
		}
		if skip {
			continue
		}
		wi.Fields = append(wi.Fields, *fi)
	}
	_, hasQuery := methods["Query"]
	_, hasHandler := methods["Handler"]
	wi.HasData = hasQuery || hasHandler
	wi.HasQuery = hasQuery
	if sig, ok := methods["computeProps"]; ok {
		var err error
		if wi.ComputedType, wi.ComputedFields, err = computedFields(pkg, sig, docs, enums); err != nil {
			return nil, fmt.Errorf("computeProps: %w", err)
		}
	}
	return wi, nil
}

// computedFields are the fields of the struct a widget's computeProps returns: its signature must be
// `computeProps(ctx *rendering.DashboardContext) (<struct of this package>, error)`.
func computedFields(pkg *packages.Package, sig *types.Signature, docs map[string]string, enums map[string]enumInfo) (string, []fieldInfo, error) {
	const want = "want computeProps(ctx *rendering.DashboardContext) (<struct of this package>, error)"
	if sig.Params().Len() != 1 || sig.Results().Len() != 2 || sig.Results().At(1).Type().String() != "error" {
		return "", nil, fmt.Errorf("%s, got %s", want, sig)
	}
	ctx, ok := sig.Params().At(0).Type().(*types.Pointer)
	if !ok || !isNamedFrom(ctx.Elem(), "rendering", "DashboardContext") {
		return "", nil, fmt.Errorf("%s, got %s", want, sig)
	}
	named, ok := sig.Results().At(0).Type().(*types.Named)
	if !ok || named.Obj().Pkg() != pkg.Types {
		return "", nil, fmt.Errorf("%s, got %s", want, sig)
	}
	st, ok := named.Underlying().(*types.Struct)
	if !ok {
		return "", nil, fmt.Errorf("%s, got %s", want, sig)
	}
	var fields []fieldInfo
	for i := 0; i < st.NumFields(); i++ {
		fi, skip, err := classifyField(pkg, named.Obj().Name(), st.Field(i), st.Tag(i), docs, enums, nil, nil)
		if err != nil {
			return "", nil, fmt.Errorf("field %q: %w", st.Field(i).Name(), err)
		}
		if !skip {
			fields = append(fields, *fi)
		}
	}
	return named.Obj().Name(), fields, nil
}

// classifyField classifies one struct field. Returns (info, skip, error).
func classifyField(pkg *packages.Package, typeName string, f *types.Var, tag string, docs map[string]string, enums map[string]enumInfo, methods map[string]*types.Signature, ctorOrder map[string]int) (*fieldInfo, bool, error) {
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

	cat, sub, err := categoryOf(pkg, f.Type(), enums)
	if err != nil {
		return nil, false, err
	}
	fi.Category = cat
	fi.Group = sub.group
	fi.GroupType = sub.groupType
	fi.EnumType = sub.enumType
	fi.EnumPkg = sub.enumPkg
	fi.EnumOptions = sub.enumOptions
	fi.Required = cat == catQueryable || cat == catField || cat == catTsField

	// Query role (dimension | measure) for field slots, driving the editor's
	// kind picker. Only meaningful on field categories; a TimestampedField is
	// always a temporal dimension so it defaults to one.
	role := dashicaTag["role"]
	isFieldCat := cat == catField || cat == catTsField || cat == catOptField
	switch {
	case role == "":
		if cat == catTsField {
			role = "dimension"
		}
	case role != "dimension" && role != "measure":
		return nil, false, fmt.Errorf("role tag must be \"dimension\" or \"measure\", got %q", role)
	case !isFieldCat:
		return nil, false, fmt.Errorf("role tag only valid on SqlField/TimestampedField slots, not %s", cat)
	}
	fi.Role = role

	// A query stays on the server, children are their Node's; neither is in the props.
	fi.Client = dashicaTag["client"] == "true"
	if fi.Client && (cat == catQueryable || cat == catChildrenList || cat == catChildrenMap) {
		return nil, false, fmt.Errorf("client tag not valid on %s: it is not sent in the props", cat)
	}

	// gocode mapping: a field is a constructor argument when the constructor
	// assigns it (the SqlQueryable of a chart; name/label/options of a
	// parameter widget); otherwise it is a chained builder call whose method
	// name is the identity title-case of the field, unless overridden by
	// `dashica-gen:"method=..."` (grid areas → Area, collapsibleGroup widgets →
	// Widget).
	if order, ok := ctorOrder[name]; ok {
		fi.IsCtorArg = true
		fi.CtorOrder = order
	} else {
		method := upperFirst(name)
		if ov := dashicaTag["method"]; ov != "" {
			method = ov
		}
		fi.GoMethod = method
		if sig, ok := methods[method]; ok {
			fi.MethodExists = true
			fi.MethodParams = sig.Params().Len()
			fi.MethodVariadic = sig.Variadic()
		}
	}
	return fi, false, nil
}

// subInfo carries the extra data a group/enum field needs.
type subInfo struct {
	group       []fieldInfo
	groupType   string
	enumType    string
	enumPkg     string
	enumOptions []enumValue
}

// categoryOf maps a Go type to a fieldCategory (the closed supported set).
func categoryOf(pkg *packages.Package, t types.Type, enums map[string]enumInfo) (fieldCategory, subInfo, error) {
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
		if e, ok := enums[obj.Pkg().Path()+"."+obj.Name()]; ok {
			sub.enumType = obj.Name()
			if obj.Pkg() != pkg.Types {
				sub.enumType = e.PkgName + "." + obj.Name()
			}
			sub.enumPkg = e.PkgPath
			sub.enumOptions = e.Values
			return catEnum, sub, nil
		}
		// A named struct with all-exported fields is a group (e.g. StackOptions).
		if st, ok := n.Underlying().(*types.Struct); ok {
			grp, err := classifyGroup(pkg, obj.Name(), st, enums)
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

func classifyGroup(pkg *packages.Package, typeName string, st *types.Struct, enums map[string]enumInfo) ([]fieldInfo, error) {
	var out []fieldInfo
	for i := 0; i < st.NumFields(); i++ {
		f := st.Field(i)
		if !f.Exported() {
			return nil, fmt.Errorf("group %s has unexported field %q", typeName, f.Name())
		}
		cat, sub, err := categoryOf(pkg, f.Type(), enums)
		if err != nil {
			return nil, fmt.Errorf("group %s field %q: %w", typeName, f.Name(), err)
		}
		out = append(out, fieldInfo{
			GoName:      f.Name(),
			JSONKey:     lowerFirst(f.Name()),
			Category:    cat,
			EnumType:    sub.enumType,
			EnumPkg:     sub.enumPkg,
			EnumOptions: sub.enumOptions,
			Group:       sub.group,
		})
	}
	return out, nil
}

func methodSet(named *types.Named) map[string]*types.Signature {
	out := map[string]*types.Signature{}
	// Methods on the pointer receiver (builder methods are pointer-receiver).
	ptr := types.NewPointer(named)
	ms := types.NewMethodSet(ptr)
	for i := 0; i < ms.Len(); i++ {
		obj := ms.At(i).Obj()
		if sig, ok := obj.Type().(*types.Signature); ok {
			out[obj.Name()] = sig
		}
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

// collectEnums adds the enums of `pkg` and of the packages of this module it imports to `enums`, by
// "<import path>.<Type>".
func collectEnums(pkg *packages.Package, enums map[string]enumInfo) error {
	var err error
	packages.Visit([]*packages.Package{pkg}, nil, func(p *packages.Package) {
		if err != nil || !strings.HasPrefix(p.PkgPath, modulePath) {
			return
		}
		found, findErr := findEnums(p)
		if findErr != nil {
			err = findErr
			return
		}
		for name, e := range found {
			enums[p.PkgPath+"."+name] = e
		}
	})
	return err
}
