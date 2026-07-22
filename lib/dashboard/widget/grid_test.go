package widget

import (
	"reflect"
	"testing"
)

func TestGrid_ResolvedTemplate_DefaultsToSortedAreaStack(t *testing.T) {
	// No Template() set: areas stack one per row in sorted-name order — this is
	// what lets the Explore editor build a grid by just adding auto-named
	// widgets ("a", "b", …) with no template configuration.
	g := NewGrid().
		Area("b", NewMarkdown()).
		Area("a", NewMarkdown())

	if got := g.resolvedTemplate(); !reflect.DeepEqual(got, []string{"a", "b"}) {
		t.Errorf("resolvedTemplate() = %v, want [a b]", got)
	}
}

func TestGrid_ResolvedTemplate_ExplicitTemplateWins(t *testing.T) {
	// An explicit Template() (compiled 2D dashboards) is used verbatim.
	tmpl := []string{"header header", "sidebar main"}
	g := NewGrid().Template(tmpl...).Area("main", NewMarkdown())

	if got := g.resolvedTemplate(); !reflect.DeepEqual(got, tmpl) {
		t.Errorf("resolvedTemplate() = %v, want %v", got, tmpl)
	}
}
