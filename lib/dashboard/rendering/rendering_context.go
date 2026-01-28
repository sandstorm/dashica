package rendering

import "github.com/a-h/templ"

type RenderingContext struct {
	// MainMenu returns the registered dashboard groups for this Dashica instance (e.g. for building a menu)
	MainMenu *[]MenuGroup
	// current handler URL - to determine the current page
	CurrentHandlerUrl string
	FilterButtons     []FilterButton
}

type MenuGroup struct {
	Title   string
	Entries []MenuGroupEntry
}

type MenuGroupEntry struct {
	Title string
	Url   string
}

type FilterButton struct {
	Title     string
	QueryPart string
}

type LayoutFunc func(renderingContext RenderingContext, filterButtons []FilterButton, content templ.Component) templ.Component
