package main

import (
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
)

// This file emits the Go-code-generation table into zz_generated.dashica.go,
// consumed by lib/explore's Go code generator (docs §4 Step 4).
//
// Unlike the editor descriptors (which are a widget-package concern, served as
// the form model), Go-code generation is purely an Explore concern — the widget
// package should not carry its model types. So the table is emitted as an opaque
// JSON blob (a string constant + accessor); lib/explore owns the Go types and
// unmarshals the blob at init. The field↔method mapping is still VERIFIED here
// at generation time via the classified model.
//
// The DTOs below mirror lib/explore's WidgetGocode / GocodeField /
// GocodeEnumValue (kept in sync by their shared JSON tags; the round-trip and
// compile-check tests catch drift).

type gcWidget struct {
	Constructor string    `json:"constructor"`
	CtorArgs    []gcField `json:"ctorArgs,omitempty"`
	Methods     []gcField `json:"methods,omitempty"`
}

type gcField struct {
	JSONKey        string      `json:"jsonKey"`
	Method         string      `json:"method,omitempty"`
	Kind           string      `json:"kind"`
	MethodParams   int         `json:"methodParams,omitempty"`
	MethodVariadic bool        `json:"methodVariadic,omitempty"`
	Fields         []gcField   `json:"fields,omitempty"`
	GroupType      string      `json:"groupType,omitempty"`
	EnumValues     []gcEnumVal `json:"enumValues,omitempty"`
}

type gcEnumVal struct {
	Str     string `json:"str"`
	VarName string `json:"varName"`
}

// gocodeJSONLiteral builds the gocode table and emits it as a Go double-quoted
// string literal (a compact JSON blob).
func gocodeJSONLiteral(m *model) (string, error) {
	table := map[string]gcWidget{}
	for _, w := range m.widgets {
		ctorArgs, methods := splitGocodeFields(w)
		gw := gcWidget{Constructor: w.Constructor}
		for _, f := range ctorArgs {
			gw.CtorArgs = append(gw.CtorArgs, gocodeField(f, true))
		}
		for _, f := range methods {
			gw.Methods = append(gw.Methods, gocodeField(f, false))
		}
		table[w.WireName] = gw
	}
	b, err := json.Marshal(table)
	if err != nil {
		return "", fmt.Errorf("marshal gocode table: %w", err)
	}
	return strconv.Quote(string(b)), nil
}

// splitGocodeFields partitions a widget's fields into constructor arguments
// (ordered by CtorOrder) and chained builder methods (struct field order).
//
// A field with no builder method (a struct field the fluent API never exposes,
// e.g. BarVertical.colorScheme, reserved for future use) is still emitted with
// an empty Method. lib/explore's emitter skips it when its value is the zero
// value (so it never appears in serialized props) and fails loudly only if it is
// somehow set — the faithful point at which "cannot reproduce this in Go"
// becomes true.
func splitGocodeFields(w widgetInfo) (ctorArgs, methods []fieldInfo) {
	for _, f := range w.Fields {
		if f.IsCtorArg {
			ctorArgs = append(ctorArgs, f)
			continue
		}
		methods = append(methods, f)
	}
	sort.SliceStable(ctorArgs, func(i, j int) bool { return ctorArgs[i].CtorOrder < ctorArgs[j].CtorOrder })
	return ctorArgs, methods
}

func gocodeField(f fieldInfo, isCtorArg bool) gcField {
	gf := gcField{
		JSONKey:        f.JSONKey,
		Kind:           string(f.Category),
		MethodParams:   f.MethodParams,
		MethodVariadic: f.MethodVariadic,
		GroupType:      f.GroupType,
	}
	if f.MethodExists && !isCtorArg {
		gf.Method = f.GoMethod
	}
	if f.Category == catGroup {
		for _, sf := range f.Group {
			gf.Fields = append(gf.Fields, gocodeField(sf, false))
		}
	}
	if f.Category == catEnum {
		for _, ev := range f.EnumOptions {
			gf.EnumValues = append(gf.EnumValues, gcEnumVal{Str: ev.Str, VarName: ev.VarName})
		}
	}
	return gf
}
