package widget

import (
	"github.com/a-h/templ"
	"github.com/sandstorm/dashica/lib/util/handler_collector"
)

type Widgets []WidgetDefinition

func (w Widgets) CollectHandlers(registerHandler handler_collector.HandlerCollector) error {
	for _, widget := range w {
		if interactive, ok := widget.(InteractiveWidget); ok {
			err := interactive.CollectHandlers(registerHandler)
			if err != nil {
				return err
			}
		}
	}
	return nil
}

type WidgetDefinition interface {
	Render() (templ.Component, error)
}

type InteractiveWidget interface {
	WidgetDefinition
	CollectHandlers(registerHandler handler_collector.HandlerCollector) error
}
