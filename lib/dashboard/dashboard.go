package dashboard

import (
	"encoding/base64"
	"fmt"
	"net/http"
	"net/url"

	"github.com/a-h/templ"
	"github.com/sandstorm/dashica/lib/components/layout"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/dashboard/widget"
	"github.com/sandstorm/dashica/lib/util"
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
	widgets   widget.Widgets
	layout    layout.Layout
	title     string
	searchBar rendering.SearchBarOption
}

func (d *Builder) WithTitle(title string) *Builder {
	cloned := *d
	cloned.title = title
	return &cloned
}

func (d *Builder) Title() string {
	return d.title
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
	components, err := util.MapHandleError(d.widgets, func(w widget.WidgetDefinition) (templ.Component, error) { return w.BuildComponents(ctx) })
	if err != nil {
		return fmt.Errorf("building components: %w", err)
	}

	err = handlerCollector.HandleRoot(templ.Handler(d.layout.Fn(*ctx, d.searchBar, templ.Join(components...))))
	if err != nil {
		return fmt.Errorf("registering layout handler: %w", err)
	}

	// "Open in Explore": redirect to the Explore editor pre-loaded with this
	// dashboard's state (via the same #s= share-link the editor already reads).
	// Registered unconditionally; it 404s at request time when Explore is not
	// wired up. The button that links here is rendered by the page layout only
	// when ctx.ExploreBaseURL is set.
	if err := handlerCollector.Handle("open-in-explore", d.openInExploreHandler(ctx)); err != nil {
		return fmt.Errorf("registering open-in-explore handler: %w", err)
	}

	return d.widgets.CollectHandlers(ctx, handlerCollector.Nested("/api"))
}

// openInExploreHandler serializes this dashboard (skipping out-of-scope widgets)
// and redirects to the Explore editor with the state in the URL fragment. The
// fragment value is query-escaped: the editor reads it via URLSearchParams,
// which would otherwise turn base64 '+' into a space before atob.
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
