package dashboard

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/sandstorm/dashica/lib/components/layout"
	"github.com/sandstorm/dashica/lib/dashboard/widget"
)

func TestDashboard_RoundTrip(t *testing.T) {
	// Note: widget *internals* do not survive yet (per-widget serializers are
	// generated in a later step); this exercises the dashboard-level envelope:
	// title, layout name, searchBar, and widget type discrimination.
	orig := New().
		WithTitle("My Dashboard").
		WithLayout(layout.DefaultPage).
		HasSearchBar(true).
		FilterButton("Errors", "level = 'error'").
		Widget(widget.NewTable(nil)).
		Widget(widget.NewMarkdown())

	b, err := MarshalDashboard(orig)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	got, err := UnmarshalDashboard(b)
	if err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	gi := got.(*dashboardImpl)
	oi := orig.(*dashboardImpl)

	if gi.title != "My Dashboard" {
		t.Errorf("title = %q", gi.title)
	}
	if gi.layout.Name != "defaultPage" {
		t.Errorf("layout = %q, want defaultPage", gi.layout.Name)
	}
	if gi.layout.Fn == nil {
		t.Error("layout Fn not resolved")
	}
	if !reflect.DeepEqual(gi.searchBar, oi.searchBar) {
		t.Errorf("searchBar mismatch:\n got  %+v\n want %+v", gi.searchBar, oi.searchBar)
	}
	if len(gi.widgets) != 2 {
		t.Fatalf("widget count = %d, want 2", len(gi.widgets))
	}
	if _, ok := gi.widgets[0].(*widget.Table); !ok {
		t.Errorf("widget[0] type = %T, want *widget.Table", gi.widgets[0])
	}
	if _, ok := gi.widgets[1].(*widget.Markdown); !ok {
		t.Errorf("widget[1] type = %T, want *widget.Markdown", gi.widgets[1])
	}
}

func TestDashboard_UnknownLayout(t *testing.T) {
	_, err := UnmarshalDashboard([]byte(`{"title":"x","layout":"nope","widgets":[]}`))
	if err == nil {
		t.Fatal("expected error for unknown layout")
	}
}

func TestDashboard_NoLayout(t *testing.T) {
	// A dashboard without WithLayout serializes with an empty layout name and
	// round-trips to a zero Layout (no invented default).
	orig := New().WithTitle("t")
	b, err := MarshalDashboard(orig)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var dto map[string]json.RawMessage
	if err := json.Unmarshal(b, &dto); err != nil {
		t.Fatalf("probe: %v", err)
	}
	if _, present := dto["layout"]; present {
		t.Errorf("empty layout should be omitted, got %s", b)
	}

	got, err := UnmarshalDashboard(b)
	if err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.(*dashboardImpl).layout.Name != "" {
		t.Errorf("expected empty layout, got %q", got.(*dashboardImpl).layout.Name)
	}
}
