package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEmitTS_WidgetsAndDTOs(t *testing.T) {
	m := loadTestModel(t)
	out := filepath.Join(t.TempDir(), "zz_generated.dashica.ts")
	if err := emitTS(m, []string{"github.com/sandstorm/dashica/lib/dashboard.PageJson"}, out); err != nil {
		t.Fatalf("emitTS: %v", err)
	}
	b, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	ts := string(b)
	for _, want := range []string{
		// required fields without "?", the query and the children left out of the props
		"export interface TimeBarProps {",
		"  x: SqlFieldProps;\n",
		"  stack?: StackOptions;",
		"  order?: 'value' | 'sum' | 'appearance' | 'inside-out';",
		"export interface GridProps {\n  /**",
		// the wire forms of fields and colors from their Go DTOs, a named string type with constants as their union
		"export interface SqlFieldProps {\n  /** Kind tells a category, which a click selects, from a count (a measure). */\n  kind: 'expr' | 'count' | 'enum' | 'autoBucket';\n  /** Alias is the field's column in the query result. */\n  alias: string;",
		"export interface ColorScale {\n  legend: boolean;",
		// widget.Node per widget type: a data URL for a widget with a handler, a rows URL for a chart, children for a
		// container
		"  | { type: 'timeBar'; props: TimeBarProps; dataUrl: string; rowsUrl?: string; filterable?: string[]; computed?: string[]; table?: string; connection?: string }",
		"  | { type: 'schemaTable'; props: SchemaTableProps; dataUrl: string }",
		"  | { type: 'grid'; props: GridProps; children?: Record<string, WidgetNode> }",
		"  | { type: 'markdown'; props: MarkdownProps }",
		// a DTO after the structs it references, a widget.Node as WidgetNode
		"export interface FilterButton {",
		"  filterButtons: FilterButton[];\n  widgets: WidgetNode[];\n}",
	} {
		if !strings.Contains(ts, want) {
			t.Errorf("missing %q", want)
		}
	}
	// the query and the children left out of the props, a field without its definition
	for _, unwanted := range []string{"  sql?:", "  sql:", "  areas", "  widgets?:", "  definition?:", "  column?:"} {
		if strings.Contains(ts, unwanted) {
			t.Errorf("unexpected %q", unwanted)
		}
	}
	if strings.Index(ts, "interface FilterButton") > strings.Index(ts, "interface PageJson") {
		t.Error("FilterButton comes after PageJson")
	}
}

func TestEmitTS_RefusesAnUnknownType(t *testing.T) {
	m := loadTestModel(t)
	if err := emitTS(m, []string{"github.com/sandstorm/dashica/lib/dashboard.Nope"}, filepath.Join(t.TempDir(), "x.ts")); err == nil {
		t.Error("expected an error for a type that does not exist")
	}
}
