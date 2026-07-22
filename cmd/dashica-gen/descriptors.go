package main

import (
	"fmt"
	"strings"
)

// This file emits the editor form-model data (widget.WidgetDescriptor per
// registered widget) into zz_generated.dashica.go, consumed by
// /explore/api/formmodel. The descriptor TYPES are hand-written in
// lib/dashboard/widget/formmodel.go; this emits only the data literal.
//
// Editor kind is derived from the field category (which dashica-gen already
// inferred from the Go type). Help is the harvested doc comment; enum fields
// carry their allowed values as select options; groups nest their sub-fields.

// editorKind maps a field category to the frontend control kind. The query
// field (catQueryable) is not a field editor — it sets WidgetDescriptor.HasQuery.
func editorKind(cat fieldCategory) string {
	switch cat {
	case catField, catTsField, catOptField:
		return "field"
	case catString:
		return "text"
	case catInt, catInt64, catPtrInt:
		return "int"
	case catBool, catPtrBool:
		return "bool"
	case catColor:
		return "colorScale"
	case catKeyValue:
		return "keyValue"
	case catStringList:
		return "stringList"
	case catGroup:
		return "group"
	case catEnum:
		return "select"
	case catChildrenList, catChildrenMap:
		return "children"
	}
	panic("editorKind: unhandled category " + string(cat))
}

// descriptorLiteral renders the body of the `map[string]WidgetDescriptor{...}`
// var — one keyed entry per widget — as gofmt-able Go source.
func descriptorLiteral(m *model) string {
	var b strings.Builder
	for _, w := range m.widgets {
		fmt.Fprintf(&b, "%q: {Title: %q, Category: %q, HasQuery: %v, QueryKey: %q, Fields: []FieldDescriptor{\n",
			w.WireName, w.Title, w.Category, hasQuery(w), queryKey(w))
		for _, f := range w.Fields {
			if f.Category == catQueryable {
				continue // rendered as the query section, flagged via HasQuery
			}
			b.WriteString(fieldDescriptorLiteral(f))
			b.WriteString(",\n")
		}
		b.WriteString("}},\n")
	}
	return b.String()
}

func hasQuery(w widgetInfo) bool {
	for _, f := range w.Fields {
		if f.Category == catQueryable {
			return true
		}
	}
	return false
}

// queryKey returns the JSON wire key of the widget's SqlQueryable field (the Go
// field name, e.g. "sql"), so the editor writes the base query under the exact
// key the generated serializer reads — no client-side guessing. Empty if the
// widget has no query.
func queryKey(w widgetInfo) string {
	for _, f := range w.Fields {
		if f.Category == catQueryable {
			return f.JSONKey
		}
	}
	return ""
}

func fieldDescriptorLiteral(f fieldInfo) string {
	var parts []string
	parts = append(parts, fmt.Sprintf("Name: %q", f.JSONKey))
	parts = append(parts, fmt.Sprintf("Editor: %q", editorKind(f.Category)))
	if f.Required {
		parts = append(parts, "Required: true")
	}
	if f.Category == catTsField {
		parts = append(parts, "Timestamped: true")
	}
	if f.Role != "" {
		parts = append(parts, fmt.Sprintf("Role: %q", f.Role))
	}
	if f.Doc != "" {
		parts = append(parts, fmt.Sprintf("Help: %q", f.Doc))
	}
	if f.Category == catEnum {
		opts := make([]string, len(f.EnumOptions))
		for i, ev := range f.EnumOptions {
			opts[i] = fmt.Sprintf("%q", ev.Str)
		}
		parts = append(parts, "Options: []string{"+strings.Join(opts, ", ")+"}")
	}
	if f.Category == catGroup {
		var sub []string
		for _, sf := range f.Group {
			sub = append(sub, fieldDescriptorLiteral(sf))
		}
		parts = append(parts, "Fields: []FieldDescriptor{"+strings.Join(sub, ", ")+"}")
	}
	return "{" + strings.Join(parts, ", ") + "}"
}
