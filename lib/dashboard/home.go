package dashboard

import (
	"encoding/json"
	"fmt"

	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/dashboard/widget"
	"github.com/sandstorm/dashica/lib/util/handler_collector"
)

// HomePage is the page.json of the start page "/": the client draws its content (the viewer's favorites, then the
// dashboards by group) from /workbench.json.
var HomePage = PageJson{Kind: "home", Title: "Home", FilterButtons: []rendering.FilterButton{}, Widgets: []widget.Node{}}

// CollectHome mounts the start page on `collector` (the server's root): the shell at exactly "/" and "/page.json".
func CollectHome(collector handler_collector.HandlerCollector) error {
	body, err := json.Marshal(HomePage)
	if err != nil {
		return fmt.Errorf("marshalling the start page's page.json: %w", err)
	}
	if err := collector.Handle("/page.json", jsonHandler(body)); err != nil {
		return err
	}
	return collector.Handle("/{$}", shellHandler)
}
