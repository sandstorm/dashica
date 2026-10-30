package widget

// TextInput is a single-line text input bound to $store.urlState.widgetParams[name].
// Other widgets on the page that send `params` automatically pick up the value.
type TextInput struct {
	// name is the widget-param slot key this input writes to.
	name string `dashica-gen:"client"`
	// label is the text shown above the input field.
	label string `dashica-gen:"client"`
	// placeholder is the input's placeholder text, shown when empty.
	placeholder string `dashica-gen:"client"`
	// prependCaret prefixes the stored value with "^" when non-empty, turning
	// a typed path prefix into a regex anchor for the SQL query.
	prependCaret bool `dashica-gen:"client"`
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
