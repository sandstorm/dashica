package widget

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"sort"
	"sync"
	"sync/atomic"
)

// This file makes widgets serializable for the Explore builder.
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

// WidgetCategory groups widgets for the Explore add-widget UI. It is a per-widget
// hint declared at Register time (the single source of truth) and copied into the
// generated WidgetDescriptor by dashica-gen, which reads it straight from the
// Register(...) calls in this file.
//
//   - CategoryChart:     a data/display widget shown in the flat add-widget list.
//   - CategoryParameter: provides a {name:String} query parameter for OTHER
//     widgets (Text Input, Checkbox Group); kept out of the add-widget list.
//   - CategoryContainer: lays out child widgets (Grid, Collapsible Group) —
//     also kept out of the flat list.
//
//dashicagen:enum
type WidgetCategory struct{ v string }

var (
	CategoryChart     = WidgetCategory{"chart"}
	CategoryParameter = WidgetCategory{"parameter"}
	CategoryContainer = WidgetCategory{"container"}
)

var (
	registryMu    sync.RWMutex
	typeToFactory = map[string]WidgetFactory{}
	goTypeToName  = map[reflect.Type]string{}
)

// Register makes a widget type serializable under the given wire name, tagged
// with its editor category (read by dashica-gen into the WidgetDescriptor). Called from init() in this package; panics on a
// duplicate name or a nil factory result (both are programmer errors caught at
// startup).
func Register(typeName string, category WidgetCategory, factory WidgetFactory) {
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

// ErrWidgetNotRegistered is returned by MarshalWidget for a widget type that
// has no registry entry; dashboard.MarshalForExplore skips these. Matched with
// errors.Is, so it survives the %w wrapping the Widgets / WidgetsMap encoders
// add around it.
var ErrWidgetNotRegistered = errors.New("widget: type not registered")

// MarshalWidget serializes any registered widget to its tagged envelope,
// delegating "props" to the widget's own MarshalJSON.
func MarshalWidget(w WidgetDefinition) ([]byte, error) {
	if w == nil {
		return []byte("null"), nil
	}

	name, err := typeName(w)
	if err != nil {
		return nil, err
	}

	props, err := json.Marshal(w)
	if err != nil {
		return nil, fmt.Errorf("widget %q: marshal props: %w", name, err)
	}
	return json.Marshal(widgetEnvelope{Type: name, Props: props})
}

// typeName is the name `w`'s type is registered under ("timeBar").
func typeName(w WidgetDefinition) (string, error) {
	registryMu.RLock()
	name, ok := goTypeToName[reflect.TypeOf(w)]
	registryMu.RUnlock()
	if !ok {
		return "", fmt.Errorf("%w: %T", ErrWidgetNotRegistered, w)
	}
	return name, nil
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
// Lenient marshalling (Explore export) — skip out-of-scope widgets
//
// The strict Marshal path fails loudly on an unregistered widget (the
// round-trip invariant). The Explore "Open in Explore" export instead wants to
// carry over what it CAN and drop the rest (alert widgets, schemaTable, …).
// Because a container widget (grid, collapsibleGroup) serializes its children
// through the same Widgets / WidgetsMap encoders below via the generated
// container MarshalJSON, the only place a per-child skip can happen is inside
// those encoders — hence a process-wide mode flag rather than a parameter that
// cannot be threaded through encoding/json.
//
// BeginLenientMarshal serialises exports with a mutex, so only one export runs
// at a time; `lenient` is atomic so the encoders can read it without the lock.
// This is safe because no code path marshals a widget strictly at request time
// (all strict marshalling is boot-time or in sequential tests) — a concurrent
// strict marshal during an export would otherwise also skip.
// ---------------------------------------------------------------------------

var (
	lenientMu      sync.Mutex
	lenient        atomic.Bool
	lenientSkipped []string
)

// BeginLenientMarshal switches on skip-unregistered mode for the calling
// goroutine's marshalling and returns (notes, done): notes() reports the
// widgets skipped (call it before done()), done() restores strict mode and must
// be deferred. Only dashboard.MarshalForExplore uses this.
func BeginLenientMarshal() (notes func() []string, done func()) {
	lenientMu.Lock()
	lenient.Store(true)
	lenientSkipped = nil
	return func() []string { return lenientSkipped },
		func() {
			lenient.Store(false)
			lenientSkipped = nil
			lenientMu.Unlock()
		}
}

// skipInLenientMode reports whether err is an out-of-scope widget that lenient
// mode should drop; it records a note when so.
func skipInLenientMode(context string, err error) bool {
	if !lenient.Load() || !errors.Is(err, ErrWidgetNotRegistered) {
		return false
	}
	lenientSkipped = append(lenientSkipped, fmt.Sprintf("%s: %v", context, err))
	return true
}

// ---------------------------------------------------------------------------
// Widgets slice + WidgetsMap — array / object of envelopes
// ---------------------------------------------------------------------------

func (w Widgets) MarshalJSON() ([]byte, error) {
	envs := make([]json.RawMessage, 0, len(w))
	for i, wd := range w {
		b, err := MarshalWidget(wd)
		if err != nil {
			if skipInLenientMode(fmt.Sprintf("widget %d", i), err) {
				continue
			}
			return nil, fmt.Errorf("widget %d: %w", i, err)
		}
		envs = append(envs, b)
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
			if skipInLenientMode(fmt.Sprintf("area %q", k), err) {
				continue
			}
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
// Registration of the widget types, by the name the widget JSON and page.json
// carry; cmd/dashica-gen emits their (de)serializers into zz_generated.dashica.go.
// ---------------------------------------------------------------------------

func init() {
	Register("timeBar", CategoryChart, func() WidgetDefinition { return NewTimeBar(nil) })
	Register("timeLine", CategoryChart, func() WidgetDefinition { return NewTimeLine(nil) })
	Register("barVertical", CategoryChart, func() WidgetDefinition { return NewBarVertical(nil) })
	Register("barHorizontal", CategoryChart, func() WidgetDefinition { return NewBarHorizontal(nil) })
	Register("timeHeatmap", CategoryChart, func() WidgetDefinition { return NewTimeHeatmap(nil) })
	Register("timeHeatmapOrdinal", CategoryChart, func() WidgetDefinition { return NewTimeHeatmapOrdinal(nil) })
	Register("stats", CategoryChart, func() WidgetDefinition { return NewStats(nil) })
	Register("table", CategoryChart, func() WidgetDefinition { return NewTable(nil) })
	Register("markdown", CategoryChart, func() WidgetDefinition { return NewMarkdown() })
	Register("grid", CategoryContainer, func() WidgetDefinition { return NewGrid() })
	Register("collapsibleGroup", CategoryContainer, func() WidgetDefinition { return NewCollapsibleGroup() })
	Register("checkboxGroup", CategoryParameter, func() WidgetDefinition { return NewCheckboxGroup("", "", nil) })
	Register("textInput", CategoryParameter, func() WidgetDefinition { return NewTextInput("", "") })
	Register("schemaTable", CategoryChart, func() WidgetDefinition { return NewSchemaTable("") })
	Register("speedscopeLink", CategoryChart, func() WidgetDefinition { return NewSpeedscopeLink(nil) })
	Register("alertOverview", CategoryChart, func() WidgetDefinition { return NewAlertOverview("") })
	Register("alertDetail", CategoryChart, func() WidgetDefinition { return NewAlertDetail("", "") })
}
