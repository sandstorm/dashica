package main

import "testing"

// loadTestModel loads the real widget package once per test. Per CLAUDE.md we do
// not re-declare widget structs in the test: the whole point is to verify the
// generator against the production types.
func loadTestModel(t *testing.T) *model {
	t.Helper()
	// The test runs from the cmd/dashica-gen dir, so it targets the widget
	// package by import path rather than "." (which `go generate` would use).
	m, err := loadModel(widgetPkgPath)
	if err != nil {
		t.Fatalf("loadModel: %v", err)
	}
	return m
}

func widgetByWire(m *model, wire string) *widgetInfo {
	for i := range m.widgets {
		if m.widgets[i].WireName == wire {
			return &m.widgets[i]
		}
	}
	return nil
}

func fieldByName(w *widgetInfo, name string) *fieldInfo {
	for i := range w.Fields {
		if w.Fields[i].GoName == name {
			return &w.Fields[i]
		}
	}
	return nil
}

func TestLoadModel_widgetsAndEnums(t *testing.T) {
	m := loadTestModel(t)

	if len(m.widgets) == 0 {
		t.Fatal("no widgets discovered")
	}
	for _, wire := range []string{"timeBar", "markdown", "grid", "collapsibleGroup"} {
		if widgetByWire(m, wire) == nil {
			t.Errorf("expected widget %q to be discovered", wire)
		}
	}

	order := m.enums["StackOrder"]
	if len(order) != 4 {
		t.Fatalf("StackOrder: want 4 values, got %d", len(order))
	}
	if order[0].VarName != "OrderValue" || order[0].Str != "value" {
		t.Errorf("StackOrder[0] = %+v, want OrderValue=value", order[0])
	}
	if len(m.enums["StackOffset"]) != 3 {
		t.Errorf("StackOffset: want 3 values, got %d", len(m.enums["StackOffset"]))
	}
}

func TestClassify_timeBar(t *testing.T) {
	m := loadTestModel(t)
	tb := widgetByWire(m, "timeBar")
	if tb == nil {
		t.Fatal("timeBar not found")
	}
	if tb.Title != "Time Bar" {
		t.Errorf("Title = %q, want %q", tb.Title, "Time Bar")
	}

	// The render-time id is internal and must be skipped.
	if fieldByName(tb, "id") != nil {
		t.Error("field id must be skipped")
	}

	want := map[string]struct {
		cat      fieldCategory
		required bool
		ctorArg  bool
	}{
		"sql":         {catQueryable, true, true},
		"x":           {catTsField, true, false},
		"y":           {catField, true, false},
		"fill":        {catOptField, false, false},
		"title":       {catString, false, false},
		"height":      {catInt, false, false},
		"width":       {catPtrInt, false, false},
		"color":       {catColor, false, false},
		"tipChannels": {catKeyValue, false, false},
		"stack":       {catGroup, false, false},
	}
	for name, w := range want {
		f := fieldByName(tb, name)
		if f == nil {
			t.Errorf("field %q missing", name)
			continue
		}
		if f.Category != w.cat {
			t.Errorf("field %q: category = %q, want %q", name, f.Category, w.cat)
		}
		if f.Required != w.required {
			t.Errorf("field %q: required = %v, want %v", name, f.Required, w.required)
		}
		if f.IsCtorArg != w.ctorArg {
			t.Errorf("field %q: isCtorArg = %v, want %v", name, f.IsCtorArg, w.ctorArg)
		}
	}

	// The queryable field keeps its Go name as the JSON key (no magic rename).
	if f := fieldByName(tb, "sql"); f != nil && f.JSONKey != "sql" {
		t.Errorf("sql JSONKey = %q, want %q", f.JSONKey, "sql")
	}

	// The stack group expands into its exported sub-fields, with the enum
	// sub-fields carrying their option sets.
	stack := fieldByName(tb, "stack")
	if stack == nil || len(stack.Group) != 3 {
		t.Fatalf("stack group: want 3 sub-fields, got %+v", stack)
	}
	orderSub := stack.Group[0]
	if orderSub.Category != catEnum || orderSub.EnumType != "StackOrder" || len(orderSub.EnumOptions) != 4 {
		t.Errorf("stack.Order sub-field = %+v, want enum StackOrder x4", orderSub)
	}
	if orderSub.JSONKey != "order" {
		t.Errorf("stack.Order JSONKey = %q, want %q", orderSub.JSONKey, "order")
	}
}

func TestClassify_markdownSkipsAssets(t *testing.T) {
	m := loadTestModel(t)
	md := widgetByWire(m, "markdown")
	if md == nil {
		t.Fatal("markdown not found")
	}
	if fieldByName(md, "assets") != nil {
		t.Error("markdown.assets (fs.FS) must be skipped via dashica-gen:\"skip\"")
	}
	for _, name := range []string{"content", "file", "title"} {
		if fieldByName(md, name) == nil {
			t.Errorf("markdown field %q missing", name)
		}
	}
}
