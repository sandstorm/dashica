package explore

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/sandstorm/dashica/lib/dashboard/widget"
)

func TestFormModel_ServesDescriptorsDefaultsAndLayouts(t *testing.T) {
	e := newTestExplore()
	rec := httptest.NewRecorder()
	if err := e.handleFormModel(rec, httptest.NewRequest(http.MethodGet, "/explore/api/formmodel", nil)); err != nil {
		t.Fatalf("handleFormModel: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}

	var resp formModelResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v\nbody: %s", err, rec.Body.String())
	}

	tb, ok := resp.Widgets["timeBar"]
	if !ok {
		t.Fatalf("timeBar missing; got widgets: %v", keys(resp.Widgets))
	}
	if tb.Title != "Time Bar" {
		t.Errorf("timeBar title = %q, want %q", tb.Title, "Time Bar")
	}
	if !tb.HasQuery {
		t.Errorf("timeBar HasQuery = false, want true")
	}

	// x is a required, timestamped field picker; the query field must NOT appear
	// as an editable field (it is the query section, flagged via HasQuery).
	x := fieldByName(tb.Fields, "x")
	if x == nil {
		t.Fatalf("timeBar field x missing")
	}
	if x.Editor != "field" || !x.Required || !x.Timestamped {
		t.Errorf("x = %+v, want editor=field required timestamped", x)
	}
	if f := fieldByName(tb.Fields, "sql"); f != nil {
		t.Errorf("query field leaked into Fields: %+v", f)
	}

	// enum -> select with options; group -> nested fields.
	stack := fieldByName(tb.Fields, "stack")
	if stack == nil || stack.Editor != "group" {
		t.Fatalf("stack group missing: %+v", stack)
	}
	order := fieldByName(stack.Fields, "order")
	if order == nil || order.Editor != "select" || len(order.Options) == 0 {
		t.Errorf("stack.order = %+v, want select with options", order)
	}

	// Defaults are the marshalled zero-value factory instance — timeBar sets
	// height=150 (NewTimeBar default), so the default set must reflect that.
	var defaults map[string]json.RawMessage
	if err := json.Unmarshal(tb.Defaults, &defaults); err != nil {
		t.Fatalf("decode timeBar defaults: %v", err)
	}
	if _, ok := defaults["height"]; !ok {
		t.Errorf("timeBar defaults missing height; got: %s", tb.Defaults)
	}

	if len(resp.Layouts) == 0 {
		t.Errorf("no layouts returned")
	}

	// fieldKinds carry the intent labels + slot metadata the pickers speak.
	byKind := map[string]fieldKind{}
	for _, fk := range resp.FieldKinds {
		byKind[fk.Kind] = fk
	}
	if ab, ok := byKind["autoBucket"]; !ok || ab.Label == "" || !ab.RequiresColumn || ab.ColumnClass != "temporal" {
		t.Errorf("autoBucket fieldKind = %+v, want labelled, requiresColumn, temporal", ab)
	}
	if cnt, ok := byKind["count"]; !ok || cnt.Label == "" || cnt.RequiresColumn {
		t.Errorf("count fieldKind = %+v, want labelled, no column", cnt)
	}
	if ex, ok := byKind["expr"]; !ok || !ex.Advanced {
		t.Errorf("expr fieldKind = %+v, want advanced", ex)
	}
}

func fieldByName(fields []widget.FieldDescriptor, name string) *widget.FieldDescriptor {
	for i := range fields {
		if fields[i].Name == name {
			return &fields[i]
		}
	}
	return nil
}

func keys[V any](m map[string]V) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
