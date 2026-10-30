package layout

import (
	"fmt"
	"sort"
	"sync"
)

// Layout is the name of a page layout, as dashboards set it (`WithLayout(layout.DefaultPage)`) and serialized
// dashboards store it. The client renders every page in the same workbench; the name stays so the dashboards and their
// JSON keep working.
type Layout struct {
	Name string
}

var (
	registryMu sync.RWMutex
	registry   = map[string]Layout{}
)

// Register makes a layout resolvable by name during dashboard deserialization.
// Called from init(); panics on an empty or a duplicate name (both programmer
// errors caught at startup).
func Register(l Layout) {
	registryMu.Lock()
	defer registryMu.Unlock()

	if l.Name == "" {
		panic("layout.Register: empty layout name")
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

// The built-in named layouts.
var (
	DefaultPage = Layout{Name: "defaultPage"}
	DocsPage    = Layout{Name: "docsPage"}
)

func init() {
	Register(DefaultPage)
	Register(DocsPage)
}
