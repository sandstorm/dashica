package widget

import (
	"context"
	"fmt"
	"html"
	"io"

	"github.com/a-h/templ"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
)

// TextInput is a single-line text input bound to $store.urlState.widgetParams[name].
// Other widgets on the page that send `params` automatically pick up the value.
type TextInput struct {
	name         string
	label        string
	placeholder  string
	prependCaret bool
}

// NewTextInput creates a text input that writes to the named widget-param slot.
func NewTextInput(name, label string) *TextInput {
	return &TextInput{name: name, label: label}
}

func (t *TextInput) Placeholder(p string) *TextInput {
	cloned := *t
	cloned.placeholder = p
	return &cloned
}

// PrependCaret enables auto-prefixing the stored value with "^" when non-empty.
// (Used in the continuous-profiling dashboard so the user types a path prefix and
// the SQL receives a regex.)
func (t *TextInput) PrependCaret() *TextInput {
	cloned := *t
	cloned.prependCaret = true
	return &cloned
}

func (t *TextInput) BuildComponents(_ *rendering.DashboardContext) (templ.Component, error) {
	prepend := "false"
	if t.prependCaret {
		prepend = "true"
	}
	htmlOut := fmt.Sprintf(`
<div class="form-control" x-data="textInput" data-name="%s" data-prepend-caret="%s">
  <label class="label"><span class="label-text font-medium">%s</span></label>
  <input type="text"
         class="input input-sm input-bordered w-full max-w-md font-mono"
         placeholder="%s"
         :value="displayValue()"
         @input="write($event)"/>
</div>
`,
		html.EscapeString(t.name),
		prepend,
		html.EscapeString(t.label),
		html.EscapeString(t.placeholder),
	)
	return templ.ComponentFunc(func(_ context.Context, w io.Writer) error {
		_, err := io.WriteString(w, htmlOut)
		return err
	}), nil
}

var _ WidgetDefinition = (*TextInput)(nil)
