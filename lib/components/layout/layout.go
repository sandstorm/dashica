package layout

import (
	"fmt"
	"sort"
	"sync"

	"github.com/sandstorm/dashica/lib/dashboard/rendering"
)

// This file makes layouts serializable for the Explore builder
// (see docs/2026-07-21-dynamic-widget-dashboard-ui.md, section 4.1 (4)).
//
// A layout is a function value, which is not data. So layouts become *named*:
// JSON stores the name, and a registry resolves it back to the function. The
// zero value of Layout has a nil Fn and no name — dashboards must set one via
// WithLayout, exactly as they had to provide a LayoutFunc before.

// Layout is a named page layout. Name is the stable wire identifier stored in
// serialized dashboards; Fn is the render function (matching the shape of the
// generated templ layout components, i.e. rendering.LayoutFunc).
type Layout struct {
	Name string
	Fn   rendering.LayoutFunc
}

var (
	registryMu sync.RWMutex
	registry   = map[string]Layout{}
)

// Register makes a layout resolvable by name during dashboard deserialization.
// Called from init(); panics on an empty name, a nil Fn, or a duplicate name
// (all programmer errors caught at startup).
func Register(l Layout) {
	registryMu.Lock()
	defer registryMu.Unlock()

	if l.Name == "" {
		panic("layout.Register: empty layout name")
	}
	if l.Fn == nil {
		panic(fmt.Sprintf("layout.Register: layout %q has a nil Fn", l.Name))
	}
	if _, dup := registry[l.Name]; dup {
		panic(fmt.Sprintf("layout.Register: duplicate layout name %q", l.Name))
	}
	registry[l.Name] = l
}

// ByName resolves a registered layout by its wire name.
func ByName(name string) (Layout, bool) {
	registryMu.RLock()
	defer registryMu.RUnlock()
	l, ok := registry[name]
	return l, ok
}

// Names lists the registered layout names, sorted. Feeds the Explore formmodel
// endpoint (layout picker).
func Names() []string {
	registryMu.RLock()
	defer registryMu.RUnlock()
	names := make([]string, 0, len(registry))
	for name := range registry {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

// The built-in named layouts. Fn points at the generated templ components
// (now unexported: defaultPageFn / docsPageFn)
var (
	DefaultPage = Layout{Name: "defaultPage", Fn: defaultPageFn}
	DocsPage    = Layout{Name: "docsPage", Fn: docsPageFn}
	ExplorePage = Layout{Name: "explorePage", Fn: explorePageFn}
)

func init() {
	Register(DefaultPage)
	Register(DocsPage)
	Register(ExplorePage)
}
