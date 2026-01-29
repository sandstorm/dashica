package widget

import (
	"github.com/a-h/templ"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
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
