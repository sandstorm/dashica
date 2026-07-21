package widget

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/a-h/templ"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
)

// fakeWidget is a leaf widget with real JSON methods, used to exercise the
// envelope's "props" delegation without depending on the not-yet-generated
// per-widget serializers.
type fakeWidget struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

func (f *fakeWidget) BuildComponents(*rendering.DashboardContext) (templ.Component, error) {
	return nil, nil
}

var _ WidgetDefinition = (*fakeWidget)(nil)

// fakeContainer is a container widget holding both a slice and a map of
// children, to exercise recursive envelope nesting via Widgets / WidgetsMap.
type fakeContainer struct {
	Items Widgets    `json:"items"`
	Areas WidgetsMap `json:"areas"`
}

func (f *fakeContainer) BuildComponents(*rendering.DashboardContext) (templ.Component, error) {
	return nil, nil
}

var _ WidgetDefinition = (*fakeContainer)(nil)

func init() {
	Register("_fakeWidget", func() WidgetDefinition { return &fakeWidget{} })
	Register("_fakeContainer", func() WidgetDefinition { return &fakeContainer{} })
}

func TestMarshalWidget_Envelope(t *testing.T) {
	w := &fakeWidget{Name: "hello", Count: 3}

	b, err := MarshalWidget(w)
	if err != nil {
		t.Fatalf("MarshalWidget: %v", err)
	}

	var env struct {
		Type  string          `json:"type"`
		Props json.RawMessage `json:"props"`
	}
	if err := json.Unmarshal(b, &env); err != nil {
		t.Fatalf("unmarshal envelope: %v", err)
	}
	if env.Type != "_fakeWidget" {
		t.Errorf("type = %q, want _fakeWidget", env.Type)
	}
	if got := string(env.Props); got != `{"name":"hello","count":3}` {
		t.Errorf("props = %s", got)
	}
}

func TestWidget_RoundTrip(t *testing.T) {
	orig := &fakeWidget{Name: "x", Count: 42}

	b, err := MarshalWidget(orig)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	got, err := UnmarshalWidget(b)
	if err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !reflect.DeepEqual(orig, got) {
		t.Errorf("round trip mismatch: %+v != %+v", orig, got)
	}
}

func TestContainer_RecursiveRoundTrip(t *testing.T) {
	orig := &fakeContainer{
		Items: Widgets{
			&fakeWidget{Name: "a", Count: 1},
			&fakeWidget{Name: "b", Count: 2},
		},
		Areas: WidgetsMap{
			"main": &fakeWidget{Name: "c", Count: 3},
		},
	}

	b, err := MarshalWidget(orig)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	got, err := UnmarshalWidget(b)
	if err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !reflect.DeepEqual(orig, got) {
		t.Errorf("round trip mismatch:\n got  %+v\n want %+v", got, orig)
	}
}

func TestWidgets_SliceRoundTrip(t *testing.T) {
	orig := Widgets{
		&fakeWidget{Name: "one", Count: 1},
		&fakeWidget{Name: "two", Count: 2},
	}

	b, err := json.Marshal(orig)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var got Widgets
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !reflect.DeepEqual(orig, got) {
		t.Errorf("round trip mismatch: %+v != %+v", got, orig)
	}
}

func TestUnmarshalWidget_UnknownType(t *testing.T) {
	_, err := UnmarshalWidget([]byte(`{"type":"nope","props":{}}`))
	if err == nil {
		t.Fatal("expected error for unknown widget type")
	}
}

func TestMarshalWidget_Unregistered(t *testing.T) {
	type unregistered struct{ fakeWidget }
	_, err := MarshalWidget(&unregistered{})
	if err == nil {
		t.Fatal("expected error for unregistered widget type")
	}
}

func TestWidget_NilHandling(t *testing.T) {
	b, err := MarshalWidget(nil)
	if err != nil {
		t.Fatalf("marshal nil: %v", err)
	}
	if string(b) != "null" {
		t.Errorf("marshal nil = %s, want null", b)
	}

	got, err := UnmarshalWidget([]byte("null"))
	if err != nil {
		t.Fatalf("unmarshal null: %v", err)
	}
	if got != nil {
		t.Errorf("unmarshal null = %+v, want nil", got)
	}
}

// All v1 widget types must resolve to a stable wire name and back to their
// concrete Go type — i.e. the registry's forward and reverse maps agree.
func TestRegisteredWidgets_TypeDiscrimination(t *testing.T) {
	for _, name := range RegisteredWidgetTypes() {
		w, err := NewWidgetByType(name)
		if err != nil {
			t.Fatalf("NewWidgetByType(%q): %v", name, err)
		}
		b, err := MarshalWidget(w)
		if err != nil {
			t.Fatalf("MarshalWidget(%q): %v", name, err)
		}
		var env struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(b, &env); err != nil {
			t.Fatalf("unmarshal envelope for %q: %v", name, err)
		}
		if env.Type != name {
			t.Errorf("type name for %q round-tripped as %q", name, env.Type)
		}
	}
}
