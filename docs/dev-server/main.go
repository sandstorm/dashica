package main

import (
	"log"
	"net/http"
	"os"

	"github.com/sandstorm/dashica"
	"github.com/sandstorm/dashica/docs/dev-server/examples/docs"
)

func main() {
	// Get port from environment or use default
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	d := dashica.New()

	// Documentation section
	d.RegisterDashboardGroup("📚 Documentation").
		RegisterDashboard("/", docs.Introduction()).
		RegisterDashboard("/docs/intro", docs.Introduction()).
		RegisterDashboard("/docs/installation", docs.Installation()).
		RegisterDashboard("/docs/quickstart", docs.QuickStart()).
		RegisterDashboard("/docs/queries", docs.Queries()).
		RegisterDashboard("/docs/widgets-overview", docs.WidgetsOverview())

	// Widget Documentation with Live Examples
	d.RegisterDashboardGroup("🎨 Widget Reference").
		RegisterDashboard("/docs/widgets/time-bar", docs.TimeBar()).
		RegisterDashboard("/docs/widgets/bar-vertical", docs.BarVertical()).
		RegisterDashboard("/docs/widgets/stats", docs.Stats())

	// Advanced Examples section (to be implemented)
	// d.RegisterDashboardGroup("🚀 Advanced Examples").
	//     RegisterDashboard("/examples/advanced/multi-widget", widgets.MultiWidgetDashboard()).
	//     ... more examples

	addr := "127.0.0.1:" + port
	log.Printf("Starting Dashica dev server on http://%s\n", addr)
	log.Printf("📚 Documentation available at http://%s/docs/intro\n", addr)
	log.Fatal(http.ListenAndServe(addr, d))
}
