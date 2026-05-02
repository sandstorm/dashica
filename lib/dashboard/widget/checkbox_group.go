package widget

import (
	"context"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"strings"

	"github.com/a-h/templ"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
)

// CheckboxGroup is a row of checkboxes bound to $store.urlState.widgetParams[name].
// The stored value is a JSON-encoded array of selected option strings, suitable for
// ClickHouse usage like `countSubstrings({name:String}, column) > 0`.
type CheckboxGroup struct {
	name     string
	label    string
	options  []string
	defaults []string
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

func (c *CheckboxGroup) BuildComponents(_ *rendering.DashboardContext) (templ.Component, error) {
	defaults := c.defaults
	if defaults == nil {
		defaults = []string{}
	}
	defaultJSON, err := json.Marshal(defaults)
	if err != nil {
		return nil, fmt.Errorf("checkboxGroup: marshal defaults: %w", err)
	}
	optionsJSON, err := json.Marshal(c.options)
	if err != nil {
		return nil, fmt.Errorf("checkboxGroup: marshal options: %w", err)
	}

	var checkboxes strings.Builder
	for _, opt := range c.options {
		optEsc := html.EscapeString(opt)
		// Use Alpine's string-arg shorthand: isChecked('GET'), toggle($event, 'GET')
		fmt.Fprintf(&checkboxes,
			`<label class="label cursor-pointer gap-1"><span class="label-text">%s</span><input type="checkbox" class="checkbox checkbox-sm" :checked="isChecked('%s')" @change="toggle($event, '%s')"/></label>`,
			optEsc, optEsc, optEsc,
		)
	}

	htmlOut := fmt.Sprintf(`
<div class="form-control" x-data="checkboxGroup" data-name="%s" data-options='%s' data-default='%s'>
  <label class="label"><span class="label-text font-medium">%s</span></label>
  <div class="flex flex-wrap items-center gap-2">%s</div>
</div>
`,
		html.EscapeString(c.name),
		// JSON inside data-* attributes — single-quoted so JSON's double quotes are fine
		string(optionsJSON),
		string(defaultJSON),
		html.EscapeString(c.label),
		checkboxes.String(),
	)

	return templ.ComponentFunc(func(_ context.Context, w io.Writer) error {
		_, err := io.WriteString(w, htmlOut)
		return err
	}), nil
}

var _ WidgetDefinition = (*CheckboxGroup)(nil)
