// Command dashica-gen is the code generator described in
// docs/2026-07-21-dynamic-widget-dashboard-ui.md, section 4.1.
//
// It parses the registered widget structs in lib/dashboard/widget (their field
// types AND doc comments) via go/packages and emits a sibling
// zz_generated.dashica.go IN THE SAME PACKAGE — which is the trick that makes
// "private" work: generated code has full access to unexported fields, so no
// accessors, no exported options structs and no runtime reflection are needed.
//
// Per widget it emits:
//  1. MarshalJSON / UnmarshalJSON reading/writing the unexported fields directly.
//  2. An editor descriptor (field order, editor kind inferred from the Go type,
//     doc comments as help texts) consumed by /explore/api/formmodel.
//  3. A code-generation table (field <-> builder method) consumed by the Go-code
//     generator (lib/explore/gocode.go, Phase 3).
//
// Emitter mechanics: stdlib text/template + go/format, no dependency (see §4.5).
package main

import (
	"flag"
	"log"
)

const widgetPkgPath = "github.com/sandstorm/dashica/lib/dashboard/widget"

func main() {
	log.SetFlags(0)
	log.SetPrefix("dashica-gen: ")

	var (
		outFile = flag.String("out", "zz_generated.dashica.go", "output file (relative to the widget package dir)")
		dryRun  = flag.Bool("dry-run", false, "classify fields and print a summary; do not write output")
	)
	flag.Parse()

	// Target package: the optional positional arg, else "." — which, under
	// `go generate`, is the directory of the file holding the //go:generate
	// directive (stringer idiom). Nothing is hardcoded to the widget package.
	pattern := "."
	if flag.NArg() > 0 {
		pattern = flag.Arg(0)
	}

	model, err := loadModel(pattern)
	if err != nil {
		log.Fatal(err)
	}

	if *dryRun {
		printSummary(model)
		return
	}

	if err := emit(model, *outFile); err != nil {
		log.Fatal(err)
	}
}

// model is everything the emitters need, derived from the parsed widget package.
type model struct {
	pkgDir  string
	widgets []widgetInfo
	// enums maps an enum type name (a struct{ v string } like StackOrder) to its
	// package-level values, in declaration order.
	enums map[string][]enumValue
}

type enumValue struct {
	VarName string // e.g. "OrderValue"
	Str     string // e.g. "value"
}

type widgetInfo struct {
	WireName string // "timeBar"
	TypeName string // "TimeBar"
	Title    string // "Time Bar" (camel-split, editor display label)
	Fields   []fieldInfo
}

// fieldCategory names how a field is (de)serialized and rendered. It is the
// closed set the generator supports; anything outside it is a hard error unless
// the field is explicitly skipped.
type fieldCategory string

const (
	catQueryable    fieldCategory = "queryable"    // sql.SqlQueryable
	catField        fieldCategory = "field"        // sql.SqlField (required)
	catTsField      fieldCategory = "tsField"      // sql.TimestampedField (required)
	catOptField     fieldCategory = "optField"     // *sql.SqlField (optional)
	catString       fieldCategory = "string"       //
	catInt          fieldCategory = "int"          //
	catInt64        fieldCategory = "int64"        //
	catBool         fieldCategory = "bool"         //
	catPtrInt       fieldCategory = "ptrInt"       // *int
	catPtrBool      fieldCategory = "ptrBool"      // *bool
	catColor        fieldCategory = "color"        // *color.ColorScale
	catKeyValue     fieldCategory = "keyValue"     // map[string]string
	catStringList   fieldCategory = "stringList"   // []string
	catGroup        fieldCategory = "group"        // named struct with exported fields (StackOptions)
	catEnum         fieldCategory = "enum"         // named struct{ v string } (StackOrder/StackOffset)
	catChildrenList fieldCategory = "childrenList" // widget.Widgets
	catChildrenMap  fieldCategory = "childrenMap"  // widget.WidgetsMap
)

type fieldInfo struct {
	GoName   string        // "sql"
	JSONKey  string        // "query"
	Category fieldCategory //
	Doc      string        // trimmed doc comment (help text)
	Required bool          //
	// group only:
	Group     []fieldInfo
	GroupType string // named struct type, e.g. "StackOptions"
	// enum only:
	EnumType    string // "StackOrder"
	EnumOptions []enumValue
	// gocode:
	GoMethod     string // builder method name (identity title-case, or override)
	MethodExists bool   // whether *TypeName actually has GoMethod
	IsCtorArg    bool   // query field -> constructor argument, not a chained call
}
