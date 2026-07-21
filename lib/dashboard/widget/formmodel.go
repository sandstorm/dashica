package widget

// This file defines the editor form-model types consumed by the Explore editor
// (docs/2026-07-21-dynamic-widget-dashboard-ui.md, section 4.4). The DATA — one
// WidgetDescriptor per registered widget — is emitted by dashica-gen into
// zz_generated.dashica.go (the var widgetDescriptors), derived from the same
// parsed structs as the JSON serializers, so a new widget option appears in the
// editor automatically. These hand-written types are the stable contract the
// generator fills and lib/explore serves.

// FieldDescriptor describes one editable field of a widget. Editor kind is
// inferred from the Go field type by dashica-gen; Help is the field's Go doc
// comment. Defaults are NOT carried here — lib/explore derives them at request
// time by marshalling a zero-value factory instance (accurate by definition).
type FieldDescriptor struct {
	// Name is the JSON property name (the wire key of the field).
	Name string `json:"name"`
	// Editor is the control kind the frontend renders: text, int, bool, select,
	// field, colorScale, keyValue, stringList, group, children.
	Editor string `json:"editor"`
	// Required marks fields without which the widget cannot build (the query
	// fields x/y and mandatory pickers).
	Required bool `json:"required,omitempty"`
	// Timestamped restricts a field picker to DateTime columns (the X axis of
	// time-series widgets).
	Timestamped bool `json:"timestamped,omitempty"`
	// Help is the Go doc comment of the field, shown as a tooltip/help text.
	Help string `json:"help,omitempty"`
	// Options are the allowed values of a select editor (enum fields).
	Options []string `json:"options,omitempty"`
	// Fields are the sub-fields of a group editor (e.g. StackOptions).
	Fields []FieldDescriptor `json:"fields,omitempty"`
}

// The data (var widgetDescriptors) and the WidgetDescriptors() accessor are
// emitted into zz_generated.dashica.go — NOT here — deliberately: the generator
// must be able to load and parse this package before that file exists (bootstrap
// / clean checkout). A hand-written reference to the generated var would make the
// package uncompilable in that window. Only lib/explore (a different package,
// not loaded by the generator) calls the accessor.

// WidgetDescriptor is the editor form model for one widget type.
type WidgetDescriptor struct {
	// Title is the display label (camel-split type name, e.g. "Time Bar").
	Title string `json:"title"`
	// HasQuery is true when the widget has a base query (its SqlQueryable field),
	// which the editor renders as a dedicated query section rather than a field.
	HasQuery bool `json:"hasQuery"`
	// Fields are the editable options, in struct order (the query field excluded;
	// see HasQuery).
	Fields []FieldDescriptor `json:"fields"`
}
