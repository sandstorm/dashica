package widget

// CheckboxGroup is a row of checkboxes bound to $store.urlState.widgetParams[name].
// The stored value is a JSON-encoded array of selected option strings, suitable for
// ClickHouse usage like `countSubstrings({name:String}, column) > 0`.
type CheckboxGroup struct {
	// name is the widget-param slot key this checkbox group writes to.
	name string `dashica-gen:"client"`
	// label is the text shown above the checkbox row.
	label string `dashica-gen:"client"`
	// options are the checkbox labels/values offered, in display order.
	options []string `dashica-gen:"client"`
	// defaults are the initially-selected options, applied only when the
	// param is empty (first page load).
	defaults []string `dashica-gen:"client,method=Default"`
}

func NewCheckboxGroup(name, label string, options []string) *CheckboxGroup {
	return &CheckboxGroup{name: name, label: label, options: options}
}

// Default sets the initially-selected options. Applied only when the param is empty
// (first page load); subsequent navigations preserve the user's selection from the URL.
func (c *CheckboxGroup) Default(defaults []string) *CheckboxGroup {
	cloned := *c
	cloned.defaults = append([]string(nil), defaults...)
	return &cloned
}
