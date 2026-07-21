package main

import (
	"fmt"
	"sort"
	"strings"
)

// printSummary prints the classified model — the -dry-run diagnostic used to
// verify every widget field lands in a supported category before emitting.
func printSummary(m *model) {
	fmt.Printf("widget package dir: %s\n", m.pkgDir)
	fmt.Printf("%d widgets, %d enum types\n\n", len(m.widgets), len(m.enums))

	var enumNames []string
	for k := range m.enums {
		enumNames = append(enumNames, k)
	}
	sort.Strings(enumNames)
	for _, en := range enumNames {
		var vals []string
		for _, v := range m.enums[en] {
			vals = append(vals, fmt.Sprintf("%s=%q", v.VarName, v.Str))
		}
		fmt.Printf("enum %s: %s\n", en, strings.Join(vals, " "))
	}
	fmt.Println()

	for _, w := range m.widgets {
		fmt.Printf("%s (%s) — %q\n", w.WireName, w.TypeName, w.Title)
		for _, f := range w.Fields {
			printField(f, 1)
		}
		fmt.Println()
	}
}

func printField(f fieldInfo, depth int) {
	indent := strings.Repeat("  ", depth)
	extra := ""
	if f.Required {
		extra += " required"
	}
	if !f.IsCtorArg && f.GoMethod != "" {
		mark := "ok"
		if !f.MethodExists {
			mark = "MISSING"
		}
		extra += fmt.Sprintf(" .%s()=%s", f.GoMethod, mark)
	}
	if f.IsCtorArg {
		extra += " [ctor-arg]"
	}
	if f.EnumType != "" {
		extra += " enum=" + f.EnumType
	}
	fmt.Printf("%s%-14s json=%-14s %-13s%s\n", indent, f.GoName, f.JSONKey, f.Category, extra)
	for _, sub := range f.Group {
		printField(sub, depth+1)
	}
}
