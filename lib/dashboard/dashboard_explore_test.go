package dashboard

import (
	"encoding/json"
	"testing"

	"github.com/sandstorm/dashica/lib/components/layout"
	"github.com/sandstorm/dashica/lib/dashboard/widget"
)

// probe mirrors the wire shape enough to count widgets and read a grid's areas.
type probe struct {
	Title   string `json:"title"`
	Layout  string `json:"layout"`
	Widgets []struct {
		Type  string          `json:"type"`
		Props json.RawMessage `json:"props"`
	} `json:"widgets"`
}

// AlertOverview is not in the widget registry, so it stands in for any
// out-of-scope widget the Explore export must drop.
func unregisteredWidget() widget.WidgetDefinition { return widget.NewAlertOverview("some-group") }

func TestMarshalForExplore_SkipsTopLevelUnregistered(t *testing.T) {
	d := New().
		WithTitle("Mixed").
		WithLayout(layout.DefaultPage).
		Widget(widget.NewTable(nil)).
		Widget(unregisteredWidget()).
		Widget(widget.NewMarkdown())

	b, skipped, err := d.MarshalForExplore()
	if err != nil {
		t.Fatalf("MarshalForExplore: %v", err)
	}
	if len(skipped) != 1 {
		t.Fatalf("skipped notes = %d (%v), want 1", len(skipped), skipped)
	}

	var p probe
	if err := json.Unmarshal(b, &p); err != nil {
		t.Fatalf("probe unmarshal: %v", err)
	}
	if len(p.Widgets) != 2 {
		t.Fatalf("kept widgets = %d, want 2 (table, markdown)", len(p.Widgets))
	}
	if p.Widgets[0].Type != "table" || p.Widgets[1].Type != "markdown" {
		t.Errorf("kept types = %q, %q; want table, markdown", p.Widgets[0].Type, p.Widgets[1].Type)
	}
}

func TestMarshalForExplore_SkipsOnlyBadChildInContainer(t *testing.T) {
	grid := widget.NewGrid().
		Template("a b").
		Area("a", widget.NewTable(nil)).
		Area("b", unregisteredWidget())

	d := New().WithLayout(layout.DefaultPage).Widget(grid)

	b, skipped, err := d.MarshalForExplore()
	if err != nil {
		t.Fatalf("MarshalForExplore: %v", err)
	}
	if len(skipped) != 1 {
		t.Fatalf("skipped notes = %d (%v), want 1", len(skipped), skipped)
	}

	var p probe
	if err := json.Unmarshal(b, &p); err != nil {
		t.Fatalf("probe unmarshal: %v", err)
	}
	// The grid itself must survive with its supported child intact.
	if len(p.Widgets) != 1 || p.Widgets[0].Type != "grid" {
		t.Fatalf("expected the grid to survive, got %s", b)
	}
	var props struct {
		Areas map[string]json.RawMessage `json:"areas"`
	}
	if err := json.Unmarshal(p.Widgets[0].Props, &props); err != nil {
		t.Fatalf("grid props unmarshal: %v", err)
	}
	if _, ok := props.Areas["a"]; !ok {
		t.Errorf("supported area 'a' was dropped: %s", p.Widgets[0].Props)
	}
	if _, ok := props.Areas["b"]; ok {
		t.Errorf("unsupported area 'b' should have been dropped: %s", p.Widgets[0].Props)
	}
}

func TestMarshalForExplore_NoSkipsWhenAllSupported(t *testing.T) {
	d := New().WithLayout(layout.DefaultPage).Widget(widget.NewTable(nil))
	_, skipped, err := d.MarshalForExplore()
	if err != nil {
		t.Fatalf("MarshalForExplore: %v", err)
	}
	if len(skipped) != 0 {
		t.Errorf("skipped = %v, want none", skipped)
	}
}

// The strict path must still fail loudly — leniency is confined to the export.
func TestMarshalDashboard_StillFailsOnUnregistered(t *testing.T) {
	d := New().WithLayout(layout.DefaultPage).Widget(unregisteredWidget())
	if _, err := MarshalDashboard(d); err == nil {
		t.Fatal("strict MarshalDashboard should error on an unregistered widget")
	}
}
