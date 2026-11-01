package dashboard

import (
	"encoding/json"

	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/dashboard/widget"
)

// MarshalDashboard serializes any Dashboard to JSON. (json.Marshal(d) works too
// when d holds a *Builder; this is the explicit, discoverable entry point.)
func MarshalDashboard(d Dashboard) ([]byte, error) {
	return json.Marshal(d)
}

// UnmarshalDashboard reconstructs a Dashboard from JSON produced by
// MarshalDashboard.
func UnmarshalDashboard(b []byte) (Dashboard, error) {
	d := &Builder{}
	if err := json.Unmarshal(b, d); err != nil {
		return nil, err
	}
	return d, nil
}

func (d *Builder) MarshalJSON() ([]byte, error) {
	return json.Marshal(dashboardDTO{
		Title:     d.title,
		SearchBar: d.searchBar,
		Widgets:   d.widgets,
	})
}

func (d *Builder) UnmarshalJSON(b []byte) error {
	var dto dashboardDTO
	if err := json.Unmarshal(b, &dto); err != nil {
		return err
	}

	*d = Builder{
		widgets:   dto.Widgets,
		title:     dto.Title,
		searchBar: dto.SearchBar,
	}
	return nil
}

// MarshalForExplore serializes a Builder for the "Open in Explore" flow: like MarshalJSON, but it skips each widget
// of a type outside the widget registry (alert widgets, schemaTable, …), also inside a grid/collapsibleGroup, where
// only that child is dropped. It returns the JSON, a note per skipped widget (for logging), and an error only for
// genuine marshalling failures. MarshalJSON is the strict one, for the round trip.
//
// Deprecated: (workbench) Explore's Go API, kept for its rebuild on the workbench; see docs/2026-10-28-workbench.md §5.
func (d *Builder) MarshalForExplore() ([]byte, []string, error) {
	notes, done := widget.BeginLenientMarshal()
	defer done()

	b, err := json.Marshal(dashboardDTO{
		Title:     d.title,
		SearchBar: d.searchBar,
		Widgets:   d.widgets,
	})
	if err != nil {
		return nil, nil, err
	}
	return b, notes(), nil
}

// dashboardDTO is the wire form of a Builder for the Explore builder: Builder keeps its unexported fields, the widgets
// delegate to the widget envelope/registry, searchBar is plain data.
type dashboardDTO struct {
	Title     string                    `json:"title,omitempty"`
	SearchBar rendering.SearchBarOption `json:"searchBar"`
	Widgets   widget.Widgets            `json:"widgets"`
}
