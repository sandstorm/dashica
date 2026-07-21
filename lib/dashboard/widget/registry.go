package widget

import (
	"bytes"
	"encoding/json"
	"fmt"
	"reflect"
	"sort"
	"sync"
)

// This file makes widgets serializable for the Explore builder
// (see docs/2026-07-21-dynamic-widget-dashboard-ui.md, section 4.1 (3)).
//
// A widget is an interface value, so encoding/json cannot decide which concrete
// type to unmarshal into. The wire format is therefore a tagged envelope:
//
//	{"type": "timeBar", "props": { ...per-widget JSON... }}
//
// "props" is delegated to the widget's own (generated) MarshalJSON/UnmarshalJSON
// — see cmd/dashica-gen and the emitted zz_generated.dashica.go. Nested-widget
// fields (Grid.areas, CollapsibleGroup.widgets) marshal through the WidgetsMap /
// Widgets JSON methods below, so children live inside their parent's "props" and
// the envelope layer stays uniform for leaf and container widgets alike.
//
// The registry is the ONLY per-widget registration needed. It also enumerates
// which structs the generator must process.

// WidgetFactory constructs a fresh, zero-value widget of a registered type
// (e.g. func() WidgetDefinition { return NewTimeBar(nil) }). It is used both to
// create instances during Unmarshal and — by the generator — to extract each
// widget's defaults by marshalling a factory instance.
type WidgetFactory func() WidgetDefinition

var (
	registryMu    sync.RWMutex
	typeToFactory = map[string]WidgetFactory{}
	goTypeToName  = map[reflect.Type]string{}
)

// Register makes a widget type serializable under the given wire name. Called
// from init() in this package; panics on a duplicate name or a nil factory
// result (both are programmer errors caught at startup).
func Register(typeName string, factory WidgetFactory) {
	registryMu.Lock()
	defer registryMu.Unlock()

	if _, dup := typeToFactory[typeName]; dup {
		panic(fmt.Sprintf("widget.Register: duplicate type name %q", typeName))
	}
	goType := reflect.TypeOf(factory())
	if goType == nil {
		panic(fmt.Sprintf("widget.Register: factory for %q returned an untyped nil", typeName))
	}
	if existing, dup := goTypeToName[goType]; dup {
		panic(fmt.Sprintf("widget.Register: Go type %s already registered as %q", goType, existing))
	}

	typeToFactory[typeName] = factory
	goTypeToName[goType] = typeName
}

// RegisteredWidgetTypes returns the registered wire names, sorted. Feeds the
// generator (which structs to process) and the formmodel endpoint.
func RegisteredWidgetTypes() []string {
	registryMu.RLock()
	defer registryMu.RUnlock()

	names := make([]string, 0, len(typeToFactory))
	for name := range typeToFactory {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

// NewWidgetByType constructs a fresh widget of the named type, or an error if no
// such type is registered.
func NewWidgetByType(typeName string) (WidgetDefinition, error) {
	registryMu.RLock()
	factory, ok := typeToFactory[typeName]
	registryMu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("widget: unknown type %q", typeName)
	}
	return factory(), nil
}

// widgetEnvelope is the tagged wire form of a single widget.
type widgetEnvelope struct {
	Type  string          `json:"type"`
	Props json.RawMessage `json:"props"`
}

// MarshalWidget serializes any registered widget to its tagged envelope,
// delegating "props" to the widget's own MarshalJSON.
func MarshalWidget(w WidgetDefinition) ([]byte, error) {
	if w == nil {
		return []byte("null"), nil
	}

	registryMu.RLock()
	name, ok := goTypeToName[reflect.TypeOf(w)]
	registryMu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("widget: type %T not registered", w)
	}

	props, err := json.Marshal(w)
	if err != nil {
		return nil, fmt.Errorf("widget %q: marshal props: %w", name, err)
	}
	return json.Marshal(widgetEnvelope{Type: name, Props: props})
}

// UnmarshalWidget reconstructs the concrete widget named by the "type"
// discriminator, delegating "props" to that widget's UnmarshalJSON. Returns nil
// for a JSON null (optional widget slots).
func UnmarshalWidget(b []byte) (WidgetDefinition, error) {
	if isJSONNull(b) {
		return nil, nil
	}

	var env widgetEnvelope
	if err := json.Unmarshal(b, &env); err != nil {
		return nil, err
	}

	w, err := NewWidgetByType(env.Type)
	if err != nil {
		return nil, err
	}
	if len(env.Props) > 0 && !isJSONNull(env.Props) {
		if err := json.Unmarshal(env.Props, w); err != nil {
			return nil, fmt.Errorf("widget %q: unmarshal props: %w", env.Type, err)
		}
	}
	return w, nil
}

// ---------------------------------------------------------------------------
// Widgets slice + WidgetsMap — array / object of envelopes
// ---------------------------------------------------------------------------

func (w Widgets) MarshalJSON() ([]byte, error) {
	envs := make([]json.RawMessage, len(w))
	for i, wd := range w {
		b, err := MarshalWidget(wd)
		if err != nil {
			return nil, fmt.Errorf("widget %d: %w", i, err)
		}
		envs[i] = b
	}
	return json.Marshal(envs)
}

func (w *Widgets) UnmarshalJSON(b []byte) error {
	var raw []json.RawMessage
	if err := json.Unmarshal(b, &raw); err != nil {
		return err
	}
	out := make(Widgets, len(raw))
	for i, r := range raw {
		wd, err := UnmarshalWidget(r)
		if err != nil {
			return fmt.Errorf("widget %d: %w", i, err)
		}
		out[i] = wd
	}
	*w = out
	return nil
}

func (w WidgetsMap) MarshalJSON() ([]byte, error) {
	envs := make(map[string]json.RawMessage, len(w))
	for k, wd := range w {
		b, err := MarshalWidget(wd)
		if err != nil {
			return nil, fmt.Errorf("area %q: %w", k, err)
		}
		envs[k] = b
	}
	return json.Marshal(envs)
}

func (w *WidgetsMap) UnmarshalJSON(b []byte) error {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(b, &raw); err != nil {
		return err
	}
	out := make(WidgetsMap, len(raw))
	for k, r := range raw {
		wd, err := UnmarshalWidget(r)
		if err != nil {
			return fmt.Errorf("area %q: %w", k, err)
		}
		out[k] = wd
	}
	*w = out
	return nil
}

func isJSONNull(b []byte) bool {
	return bytes.Equal(bytes.TrimSpace(b), []byte("null"))
}

// ---------------------------------------------------------------------------
// Registration of the v1 widget types (docs section 7).
//
// Per-widget (de)serializers do not exist yet — cmd/dashica-gen emits them into
// zz_generated.dashica.go in a later Phase-1 step. Until then MarshalWidget
// produces an empty "props" for these types; the envelope/registry layer itself
// is what this step establishes and tests.
// ---------------------------------------------------------------------------

func init() {
	Register("timeBar", func() WidgetDefinition { return NewTimeBar(nil) })
	Register("timeLine", func() WidgetDefinition { return NewTimeLine(nil) })
	Register("barVertical", func() WidgetDefinition { return NewBarVertical(nil) })
	Register("barHorizontal", func() WidgetDefinition { return NewBarHorizontal(nil) })
	Register("timeHeatmap", func() WidgetDefinition { return NewTimeHeatmap(nil) })
	Register("timeHeatmapOrdinal", func() WidgetDefinition { return NewTimeHeatmapOrdinal(nil) })
	Register("stats", func() WidgetDefinition { return NewStats(nil) })
	Register("table", func() WidgetDefinition { return NewTable(nil) })
	Register("markdown", func() WidgetDefinition { return NewMarkdown() })
	Register("grid", func() WidgetDefinition { return NewGrid() })
	Register("collapsibleGroup", func() WidgetDefinition { return NewCollapsibleGroup() })
	Register("checkboxGroup", func() WidgetDefinition { return NewCheckboxGroup("", "", nil) })
	Register("textInput", func() WidgetDefinition { return NewTextInput("", "") })
}
