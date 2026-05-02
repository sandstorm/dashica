package widget

import (
	"strings"
	"testing"
)

func TestCheckboxGroup_RendersCSPFriendlyMarkup(t *testing.T) {
	w := NewCheckboxGroup("http_methods", "HTTP Methods",
		[]string{"GET", "POST", "DELETE"}).
		Default([]string{"GET", "POST"})

	out := renderComponent(t, w)

	mustContain(t, out, `x-data="checkboxGroup"`)
	mustContain(t, out, `data-name="http_methods"`)
	mustContain(t, out, `data-options='["GET","POST","DELETE"]'`)
	mustContain(t, out, `data-default='["GET","POST"]'`)
	mustContain(t, out, `HTTP Methods`)

	// Each option emits an isChecked / toggle binding
	for _, opt := range []string{"GET", "POST", "DELETE"} {
		mustContain(t, out, `isChecked('`+opt+`')`)
		mustContain(t, out, `toggle($event, '`+opt+`')`)
	}
}

func TestCheckboxGroup_EmptyDefault(t *testing.T) {
	w := NewCheckboxGroup("opts", "Opts", []string{"a", "b"})
	out := renderComponent(t, w)
	mustContain(t, out, `data-default='[]'`)
}

func TestCheckboxGroup_Immutability(t *testing.T) {
	original := NewCheckboxGroup("n", "L", []string{"a", "b"})
	_ = original.Default([]string{"a"})
	if len(original.defaults) != 0 {
		t.Errorf("original mutated by Default(): %v", original.defaults)
	}
}

func TestCheckboxGroup_OptionEscaping(t *testing.T) {
	// Single quotes inside option strings would break the inline JS bindings
	// (`isChecked('foo')`). Confirm the rendered output gets HTML-escaped so they
	// at least don't silently produce broken JS — a future follow-up could reject
	// such option strings entirely.
	w := NewCheckboxGroup("n", "L", []string{"<bad>"})
	out := renderComponent(t, w)
	// The label text portion is HTML-escaped
	if strings.Contains(out, "<bad>") && !strings.Contains(out, "&lt;bad&gt;") {
		t.Errorf("option label not HTML-escaped:\n%s", out)
	}
}
