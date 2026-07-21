package docs

import (
	"bytes"
	"testing"

	"github.com/sandstorm/dashica/lib/dashboard"
)

// TestExampleDashboards_RoundTrip is the Phase-1 acceptance test over the real
// dev-server example dashboards (docs §4.1 (5)): marshalling a compiled
// dashboard, unmarshalling it, and re-marshalling must produce byte-identical
// JSON. Any widget field the generated serializers drop breaks stability here on
// a real dashboard, not just a synthetic fixture.
func TestExampleDashboards_RoundTrip(t *testing.T) {
	examples := map[string]func() dashboard.Dashboard{
		"BarVertical":     BarVertical,
		"ChartingBasics":  ChartingBasics,
		"Introduction":    Introduction,
		"Installation":    Installation,
		"Queries":         Queries,
		"QuickStart":      QuickStart,
		"Stats":           Stats,
		"Table":           Table,
		"TimeBar":         TimeBar,
		"UsagePhilosophy": UsagePhilosophy,
		"WidgetsOverview": WidgetsOverview,
		"Deployment":      Deployment,
		"Alerting":        Alerting,
	}

	for name, fn := range examples {
		t.Run(name, func(t *testing.T) {
			d := fn()

			b1, err := dashboard.MarshalDashboard(d)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			d2, err := dashboard.UnmarshalDashboard(b1)
			if err != nil {
				t.Fatalf("unmarshal: %v (json: %s)", err, b1)
			}
			b2, err := dashboard.MarshalDashboard(d2)
			if err != nil {
				t.Fatalf("re-marshal: %v", err)
			}
			if !bytes.Equal(b1, b2) {
				t.Errorf("JSON not stable across round trip:\n #1: %s\n #2: %s", b1, b2)
			}
		})
	}
}
