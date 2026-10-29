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
// With -ts it also writes the TypeScript types of what the server sends (ts_emit.go). With -enums it only writes the
// methods of a package's enums (enums.go).
//
// Emitter mechanics: stdlib text/template + go/format, no dependency (see §4.5).
package main

import (
	"flag"
	"log"
	"strings"
)

const (
	modulePath    = "github.com/sandstorm/dashica"
	widgetPkgPath = modulePath + "/lib/dashboard/widget"
)

func main() {
	log.SetFlags(0)
	log.SetPrefix("dashica-gen: ")

	var (
		outFile = flag.String("out", "zz_generated.dashica.go", "output file (relative to the widget package dir)")
		dryRun  = flag.Bool("dry-run", false, "classify fields and print a summary; do not write output")
		tsOut   = flag.String("ts", "", "also write the TypeScript types to this file (relative to the widget package dir)")
		tsTypes = flag.String("ts-types", "", "comma-separated Go types (<import path>.<Type>) whose TypeScript interfaces -ts adds")
		enums   = flag.Bool("enums", false, "write the methods of the package's enums (//dashicagen:enum) to zz_generated.enums.go, nothing else")
	)
	flag.Parse()

	// Target package: the optional positional arg, else "." — which, under
	// `go generate`, is the directory of the file holding the //go:generate
	// directive (stringer idiom). Nothing is hardcoded to the widget package.
	pattern := "."
	if flag.NArg() > 0 {
		pattern = flag.Arg(0)
	}

	if *enums {
		if err := emitEnums(pattern); err != nil {
			log.Fatal(err)
		}
		return
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
	if *tsOut != "" {
		var dtos []string
		if *tsTypes != "" {
			dtos = strings.Split(*tsTypes, ",")
		}
		if err := emitTS(model, dtos, *tsOut); err != nil {
			log.Fatal(err)
		}
	}
}

// model is everything the emitters need, derived from the parsed widget package.
type model struct {
	pkgDir  string
	widgets []widgetInfo
	// enums are the enums the widgets may use (//dashicagen:enum), by "<import path>.<Type>".
	enums map[string]enumInfo
}

type enumValue struct {
	VarName string // e.g. "OrderValue"
	Str     string // e.g. "value"
}

type widgetInfo struct {
	WireName    string // "timeBar"
	TypeName    string // "TimeBar"
	Title       string // "Time Bar" (camel-split, editor display label)
	Category    string // the WidgetCategory var: "CategoryChart" | "CategoryParameter" | "CategoryContainer"
	Constructor string // factory function name, e.g. "NewTimeBar" (gocode)
	Fields      []fieldInfo
	// ComputedType is the struct its method computeProps returns ("markdownComputed"), empty without one; its fields
	// (ComputedFields) are what the server computes when the page is mounted, in the props in page.json only.
	ComputedType   string
	ComputedFields []fieldInfo
	// HasHandler: it has a Handler method, so Mount gives it a data URL (withHandler).
	HasHandler bool
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
	// Role is the query role of a field slot ("dimension" | "measure"), from the
	// `dashica-gen:"role=..."` struct tag. A dimension lands in GROUP BY (bar X,
	// fill, fx, fy, heatmap y); a measure is the per-group aggregation (bar Y,
	// heatmap fill). It drives which field *kinds* the editor picker offers, so a
	// dimension slot never shows "Row count" (a measure) and vice versa. Only
	// set on field categories; a TimestampedField defaults to "dimension".
	Role string
	// Client is whether the field goes to the client, in the widget's props in page.json (marshalProps) and its
	// TypeScript props: the `dashica-gen:"client"` struct tag. Every other field stays on the server.
	Client bool
	// group only:
	Group     []fieldInfo
	GroupType string // named struct type, e.g. "StackOptions"
	// enum only:
	EnumType    string // its Go type: "StackOrder", "color.Scheme" from another package
	EnumPkg     string // its package's import path
	EnumOptions []enumValue
	// gocode:
	GoMethod     string // builder method name (identity title-case, or override)
	MethodExists bool   // whether *TypeName actually has GoMethod
	IsCtorArg    bool   // field is passed to the constructor, not a chained call
	// CtorOrder is the position of this field in the constructor's parameter
	// list (only meaningful when IsCtorArg). Fields are emitted as constructor
	// arguments in ascending CtorOrder.
	CtorOrder int
	// MethodParams / MethodVariadic describe the builder method's signature, so
	// the value emitter can tell a no-arg toggle (Open()) from a one-arg setter
	// and a variadic method (Template(...string)) from a slice one
	// (Default([]string)). Only set when MethodExists.
	MethodParams   int
	MethodVariadic bool
}
