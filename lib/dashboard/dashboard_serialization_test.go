package dashboard

import (
	"reflect"
	"testing"

	"github.com/sandstorm/dashica/lib/dashboard/widget"
)

func TestDashboard_RoundTrip(t *testing.T) {
	// Note: widget *internals* do not survive yet (per-widget serializers are
	// generated in a later step); this exercises the dashboard-level envelope:
	// title, searchBar, and widget type discrimination.
	orig := New().
		WithTitle("My Dashboard").
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

	gi := got.(*Builder)
	oi := orig

	if gi.title != "My Dashboard" {
		t.Errorf("title = %q", gi.title)
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
