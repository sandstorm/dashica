package dashboard

import (
	"net/http"

	"github.com/a-h/templ"
	"github.com/sandstorm/dashica/lib/components/layout"
	"github.com/sandstorm/dashica/lib/dashboard/widget"
)

type Dashboard interface {
	Widget(w widget.TimeBarBuilder) Dashboard
	WithDefaultLayout() Dashboard
	HttpHandler() http.Handler
}

func New() Dashboard {
	return &dashboardImpl{}
}

type dashboardImpl struct {
	widgets []widget.TimeBarBuilder
	layout  templ.Component
}

func (d *dashboardImpl) Widget(w widget.TimeBarBuilder) Dashboard {
	cloned := *d
	cloned.widgets = append(cloned.widgets, w)
	return &cloned
}

func (d *dashboardImpl) WithDefaultLayout() Dashboard {
	cloned := *d
	cloned.layout = layout.DefaultPage()
	return &cloned
}

func (d *dashboardImpl) HttpHandler() http.Handler {
	return templ.Handler(d.layout)
}

var _ Dashboard = &dashboardImpl{}
