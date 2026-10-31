package dashboard

import (
	"net/http"

	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/dashboard/widget"
)

// PageJson is what "<page>/page.json" says about a page: everything the client needs to show it.
type PageJson struct {
	// Kind is the kind of page: "dashboard", or "home" for the start page (HomePage).
	Kind  string `json:"kind"`
	Title string `json:"title"`
	// DefaultTime is the time range the page opens with, as a Go duration ("168h"); empty: 24h.
	DefaultTime string `json:"defaultTime,omitempty"`
	// FilterBar is whether the page shows the filter bar.
	FilterBar     bool                     `json:"filterBar"`
	FilterButtons []rendering.FilterButton `json:"filterButtons"`
	Widgets       []widget.Node            `json:"widgets"`
}

// jsonHandler serves `body` as JSON.
func jsonHandler(body []byte) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
	})
}
