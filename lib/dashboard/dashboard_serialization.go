package dashboard

import (
	"encoding/json"
	"fmt"

	"github.com/sandstorm/dashica/lib/components/layout"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/dashboard/widget"
)

// This file makes a dashboard serializable for the Explore builder
// (see docs/2026-07-21-dynamic-widget-dashboard-ui.md, section 4.1 (4)).
//
// Builder keeps its unexported fields; a DTO carries the wire form. The
// layout is a function value, so only its registered Name is stored and
// re-resolved via layout.ByName on unmarshal (see lib/components/layout). The
// widgets delegate to the widget envelope/registry; searchBar is plain data.

type dashboardDTO struct {
	Title     string                    `json:"title,omitempty"`
	Layout    string                    `json:"layout,omitempty"`
	SearchBar rendering.SearchBarOption `json:"searchBar"`
	Widgets   widget.Widgets            `json:"widgets"`
}

func (d *Builder) MarshalJSON() ([]byte, error) {
	return json.Marshal(dashboardDTO{
		Title:     d.title,
		Layout:    d.layout.Name,
		SearchBar: d.searchBar,
		Widgets:   d.widgets,
	})
}

func (d *Builder) UnmarshalJSON(b []byte) error {
	var dto dashboardDTO
	if err := json.Unmarshal(b, &dto); err != nil {
		return err
	}

	var l layout.Layout
	if dto.Layout != "" {
		resolved, ok := layout.ByName(dto.Layout)
		if !ok {
			return fmt.Errorf("dashboard: unknown layout %q", dto.Layout)
		}
		l = resolved
	}

	*d = Builder{
		widgets:   dto.Widgets,
		layout:    l,
		title:     dto.Title,
		searchBar: dto.SearchBar,
	}
	return nil
}

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
