package widget

import (
	"fmt"
	"net/http"

	"github.com/a-h/templ"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
	"github.com/sandstorm/dashica/lib/httpserver"
	"github.com/sandstorm/dashica/lib/util/handler_collector"
)

type Widgets []WidgetDefinition

type WidgetsMap map[string]WidgetDefinition

func (w Widgets) CollectHandlers(ctx *rendering.DashboardContext, registerHandler handler_collector.HandlerCollector) error {
	for _, widget := range w {
		if interactive, ok := widget.(InteractiveWidget); ok {
			err := interactive.CollectHandlers(ctx, registerHandler)
			if err != nil {
				return err
			}
		}
	}
	return nil
}

func (w WidgetsMap) CollectHandlers(ctx *rendering.DashboardContext, registerHandler handler_collector.HandlerCollector) error {
	for _, widget := range w {
		if interactive, ok := widget.(InteractiveWidget); ok {
			err := interactive.CollectHandlers(ctx, registerHandler)
			if err != nil {
				return err
			}
		}
	}
	return nil
}

type WidgetDefinition interface {
	BuildComponents(ctx *rendering.DashboardContext) (templ.Component, error)
}

type InteractiveWidget interface {
	WidgetDefinition
	CollectHandlers(ctx *rendering.DashboardContext, registerHandler handler_collector.HandlerCollector) error
}

// RegisterQueryHandlers is a helper function that registers both query and debug endpoints for a widget
// widgetId: the unique identifier for the widget (used to generate endpoint paths)
// widgetName: the name of the widget type (used in error messages)
// query: the SQL query to execute
// ctx: the dashboard rendering context
// registerHandler: the handler collector to register handlers with
func RegisterQueryHandlers(widgetId, widgetName string, query sql.SqlQueryable, ctx *rendering.DashboardContext, registerHandler handler_collector.HandlerCollector) error {
	qh := httpserver.QueryHandler{
		ClickhouseClientManager: ctx.Deps.ClickhouseClientManager,
		Logger:                  ctx.Deps.Logger,
		FileSystem:              ctx.Deps.FileSystem,
	}

	// Register query endpoint
	err := registerHandler.Handle(widgetId+"/query", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		err := qh.HandleQuery(query, w, r)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
	}))
	if err != nil {
		return fmt.Errorf("%s: %w", widgetName, err)
	}

	// Register debug endpoint
	err = registerHandler.Handle(widgetId+"/debug", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		err := qh.HandleDebug(query, w, r)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
	}))
	if err != nil {
		return fmt.Errorf("%s: %w", widgetName, err)
	}

	return nil
}
