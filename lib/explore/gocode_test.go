package explore

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/sandstorm/dashica/lib/components/layout"
	"github.com/sandstorm/dashica/lib/dashboard"
	"github.com/sandstorm/dashica/lib/dashboard/color"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
	"github.com/sandstorm/dashica/lib/dashboard/widget"
)

// sampleDashboard builds a dashboard exercising every registered widget type and
// every value-emitter path (queries, fields of each kind, color scales, groups,
// enums, key/values, string lists, nested container children). The widgets are
// built via the public fluent API — the very code the generator must reproduce —
// so the generated source doubles as a reconstruction of this dashboard.
func sampleDashboard() *dashboard.Builder {
	baseQuery := sql.New(sql.From("full_logs"), sql.Where("level = 'error'"))
	return dashboard.New().
		WithTitle("Demo Dashboard").
		WithLayout(layout.DefaultPage).
		Widget(widget.NewTimeBar(baseQuery).
			Title("Errors over time").Height(150).
			X(sql.AutoBucket("timestamp")).
			Y(sql.Count().WithAlias("logs")).
			Fill(sql.Enum("level")).
			Width(600).MarginLeft(40).
			TipChannels(map[string]string{"level": "Level"}).
			Color(color.ColorLegend(true), color.ColorMapping("error", "#E74C3C")).
			StackOptions(widget.StackOptions{Order: widget.OrderSum, Offset: widget.OffsetExpand, Reverse: true})).
		Widget(widget.NewTimeLine(baseQuery).
			Title("Line").X(sql.AutoBucket("timestamp")).Y(sql.Count()).
			Stroke("level").WithFillStep("toIntervalHour(1)")).
		Widget(widget.NewBarVertical(baseQuery).
			X(sql.Enum("level")).Y(sql.Count()).SortByY(true)).
		Widget(widget.NewBarHorizontal(baseQuery).X(sql.Count()).Y(sql.Enum("level"))).
		Widget(widget.NewTimeHeatmap(baseQuery).X(sql.AutoBucket("timestamp")).Y(sql.Enum("level"))).
		Widget(widget.NewTimeHeatmapOrdinal(baseQuery).
			X(sql.AutoBucket("timestamp")).Y(sql.Enum("level")).ColorScheme("reds")).
		Widget(widget.NewStats(baseQuery).TitleField(sql.Field("level")).FillField(sql.Count())).
		Widget(widget.NewTable(baseQuery).Title("Rows").Limit(50)).
		Widget(widget.NewMarkdown().Title("Docs").Content("# Hello")).
		Widget(widget.NewGrid().Gap("1rem").
			Area("a", widget.NewTable(baseQuery).Title("A")).
			Area("b", widget.NewTable(baseQuery).Title("B"))).
		Widget(widget.NewCollapsibleGroup().Title("Group").Open().
			Widget(widget.NewTable(baseQuery).Title("Inner"))).
		Widget(widget.NewCheckboxGroup("lvl", "Level", []string{"error", "warn"}).
			Default([]string{"error"})).
		Widget(widget.NewTextInput("q", "Query").Placeholder("search...").PrependCaret())
}

// TestGenerateDashboardCode_fragments checks the generator emits the idiomatic
// constructors (docs §2.1: kind ≡ constructor), not baked expressions, and wires
// containers via their real child methods.
func TestGenerateDashboardCode_fragments(t *testing.T) {
	stateJSON, _, err := sampleDashboard().MarshalForExplore()
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	src, err := GenerateDashboardCode(stateJSON)
	if err != nil {
		t.Fatalf("generate: %v", err)
	}

	wants := []string{
		"func Dashboard() dashboard.Dashboard {",
		"dashboard.New()",
		`WithTitle("Demo Dashboard")`,
		"WithLayout(layout.DefaultPage)",
		"widget.NewTimeBar(",
		`sql.From("full_logs")`,
		`sql.Where("level = 'error'")`,
		`sql.AutoBucket("timestamp")`,   // not sql.Field("toStartOf...")
		`sql.Count().WithAlias("logs")`, // idiomatic count + alias
		`sql.Enum("level")`,             // idiomatic enum, not baked ::String
		"color.ColorLegend(true)",
		`color.ColorMapping("error", "#E74C3C")`,
		"widget.StackOptions{Order: widget.OrderSum, Offset: widget.OffsetExpand, Reverse: true}",
		"SortByY(true)",
		`WithFillStep("toIntervalHour(1)")`,
		"ColorScheme(\"reds\")",
		`Area("a",`, // grid child via Area(name, widget)
		"widget.NewTable(",
		"Widget(", // collapsibleGroup child via Widget(widget)
		`widget.NewCheckboxGroup("lvl", "Level", []string{"error", "warn"})`,
		`Default([]string{"error"})`,
		`widget.NewTextInput("q", "Query")`,
		"PrependCaret()",
	}
	for _, w := range wants {
		if !strings.Contains(src, w) {
			t.Errorf("generated code missing %q\n---\n%s", w, src)
		}
	}

	// It must NOT fall back to baked expressions for the idiomatic kinds.
	for _, bad := range []string{`sql.Field("count(*)")`, `sql.Field("level::String")`} {
		if strings.Contains(src, bad) {
			t.Errorf("generated code used a baked expression %q instead of the constructor\n---\n%s", bad, src)
		}
	}
}

// TestGenerateDashboardCode_fileAndRawQueries covers the file/inline query
// emitters (the table path is covered above).
func TestGenerateDashboardCode_fileAndRawQueries(t *testing.T) {
	d := dashboard.New().
		Widget(widget.NewTable(sql.FromFile("queries/logs.sql").With(sql.Where("x = 1")))).
		Widget(widget.NewTable(sql.FromStringWithoutFilters("SELECT 1")))
	stateJSON, _, err := d.MarshalForExplore()
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	src, err := GenerateDashboardCode(stateJSON)
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	for _, w := range []string{
		`sql.FromFile("queries/logs.sql")`,
		`.With(`,
		`sql.Where("x = 1")`,
		`sql.FromStringWithoutFilters("SELECT 1")`,
	} {
		if !strings.Contains(src, w) {
			t.Errorf("missing %q\n---\n%s", w, src)
		}
	}
}

// TestGenerateDashboardCode_compiles is the CI compile check: the generated
// source is written into a throwaway package inside the module and built with
// `go build`. A wrong method name, wrong argument type, missing import or a
// non-compiling multi-arg constructor fails here.
func TestGenerateDashboardCode_compiles(t *testing.T) {
	goBin, err := exec.LookPath("go")
	if err != nil {
		t.Skip("go toolchain not on PATH; skipping compile check")
	}

	stateJSON, _, err := sampleDashboard().MarshalForExplore()
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	src, err := GenerateDashboardCode(stateJSON)
	if err != nil {
		t.Fatalf("generate: %v", err)
	}

	// A package dir inside the module (working dir is lib/explore) so the
	// dashica import paths resolve. Unique name + cleanup so a crashed run cannot
	// leave a stale package that breaks later builds.
	dir := "zz_gocode_compilecheck"
	_ = os.RemoveAll(dir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	defer os.RemoveAll(dir)
	if err := os.WriteFile(filepath.Join(dir, "gen.go"), []byte(src), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}

	cmd := exec.Command(goBin, "build", "./"+dir)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("generated code does not compile: %v\n%s\n--- source ---\n%s", err, out, src)
	}
}
