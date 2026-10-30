package dashboard

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"github.com/sandstorm/dashica/lib/components/layout"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/dashboard/widget"
	"github.com/sandstorm/dashica/lib/util/handler_collector"
)

// Dashboard is the registration contract consumed by Dashica.RegisterDashboard:
// something that has a title and can mount its own HTTP handlers. It is
// deliberately small — the fluent construction API (Widget, WithLayout, ...)
// lives on the concrete *Builder returned by New(), not on this interface, so
// that alternative implementations (e.g. the Explore editor) need only satisfy
// these two methods.
type Dashboard interface {
	Title() string
	CollectHandlers(ctx *rendering.DashboardContext, handlerCollector handler_collector.HandlerCollector) error
}

// New starts building a standard widget dashboard. The returned *Builder is a
// Dashboard; its fluent methods return *Builder so calls chain.
func New() *Builder {
	d := &Builder{}
	d.searchBar.IsVisible = true
	return d
}

// Builder is the standard widget-list dashboard implementation and its fluent
// construction API.
type Builder struct {
	widgets     widget.Widgets
	layout      layout.Layout
	title       string
	defaultTime string
	searchBar   rendering.SearchBarOption
}

func (d *Builder) WithTitle(title string) *Builder {
	cloned := *d
	cloned.title = title
	return &cloned
}

func (d *Builder) Title() string {
	return d.title
}

// DefaultTimeRange is the time range the page opens with, as a Go duration ("1h", "168h" for 7 days); 24h when unset.
func (d *Builder) DefaultTimeRange(duration string) *Builder {
	cloned := *d
	cloned.defaultTime = duration
	return &cloned
}

func (d *Builder) Widget(w widget.WidgetDefinition) *Builder {
	cloned := *d
	cloned.widgets = append(cloned.widgets, w)
	return &cloned
}

func (d *Builder) WithLayout(l layout.Layout) *Builder {
	cloned := *d
	cloned.layout = l
	return &cloned
}

func (d *Builder) HasSearchBar(value bool) *Builder {
	cloned := *d
	cloned.searchBar.IsVisible = value
	return &cloned
}

func (d *Builder) FilterButton(title string, queryPart string) *Builder {
	cloned := *d
	cloned.searchBar.FilterButtons = append(cloned.searchBar.FilterButtons, rendering.FilterButton{
		Title:     title,
		QueryPart: queryPart,
	})
	return &cloned
}

func (d *Builder) CollectHandlers(ctx *rendering.DashboardContext, handlerCollector handler_collector.HandlerCollector) error {
	if d.defaultTime != "" {
		if _, err := time.ParseDuration(d.defaultTime); err != nil {
			return fmt.Errorf("DefaultTimeRange(%q) is not a Go duration (\"168h\" for 7 days): %w", d.defaultTime, err)
		}
	}
	nodes, err := d.widgets.Mount(ctx, handlerCollector.Nested("/api"))
	if err != nil {
		return fmt.Errorf("mounting widgets: %w", err)
	}
	page, err := json.Marshal(PageJson{
		Kind:          "dashboard",
		Title:         d.title,
		DefaultTime:   d.defaultTime,
		FilterBar:     d.searchBar.IsVisible,
		FilterButtons: append([]rendering.FilterButton{}, d.searchBar.FilterButtons...),
		Widgets:       nodes,
	})
	if err != nil {
		return fmt.Errorf("marshalling page.json: %w", err)
	}
	if err := handlerCollector.Handle("page.json", jsonHandler(page)); err != nil {
		return fmt.Errorf("registering page.json handler: %w", err)
	}

	if err := handlerCollector.HandleRoot(shellHandler); err != nil {
		return fmt.Errorf("registering the shell: %w", err)
	}

	// "Open in Explore": redirect to the Explore editor pre-loaded with this
	// dashboard's state (via the same #s= share-link the editor already reads).
	// Registered unconditionally; it 404s at request time when Explore is not
	// wired up. No page links here while Explore is rebuilt (DEPRECATED (workbench)).
	if err := handlerCollector.Handle("open-in-explore", d.openInExploreHandler(ctx)); err != nil {
		return fmt.Errorf("registering open-in-explore handler: %w", err)
	}

	return nil
}

// openInExploreHandler serializes this dashboard (skipping out-of-scope widgets)
// and redirects to the Explore editor with the state in the URL fragment. The
// fragment value is query-escaped: the editor reads it via URLSearchParams,
// which would otherwise turn base64 '+' into a space before atob.
//
// Deprecated: (workbench) Explore's Go API, kept for its rebuild on the workbench; see docs/2026-10-28-workbench.md §5.
func (d *Builder) openInExploreHandler(ctx *rendering.DashboardContext) http.Handler {
	exploreBaseURL := ctx.ExploreBaseURL
	logger := ctx.Deps.Logger
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if exploreBaseURL == nil || *exploreBaseURL == "" {
			http.Error(w, "Explore view is not registered", http.StatusNotFound)
			return
		}
		jsonBytes, skipped, err := d.MarshalForExplore()
		if err != nil {
			http.Error(w, fmt.Sprintf("cannot open in Explore: %v", err), http.StatusInternalServerError)
			return
		}
		for _, s := range skipped {
			logger.Warn().Str("dashboard", d.title).Str("skipped", s).
				Msg("Open in Explore: dropping out-of-scope widget")
		}
		encoded := base64.StdEncoding.EncodeToString(jsonBytes)
		location := *exploreBaseURL + "#s=" + url.QueryEscape(encoded)
		w.Header().Set("Location", location)
		w.WriteHeader(http.StatusFound)
	})
}

var _ Dashboard = (*Builder)(nil)
