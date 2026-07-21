package widget

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/sandstorm/dashica/lib/dashboard/color"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
)

// This is the Phase-1 acceptance test (docs §4.1 (5)): for a widget built via
// the fluent API, the JSON round trip must be lossless. "Lossless" is proven two
// ways:
//
//   - Structural stability: MarshalWidget(w) == MarshalWidget(roundTrip(w)).
//     Any field the generated serializer forgets to write/read changes the
//     second marshalling, turning silent drift into a red test.
//   - Semantic equivalence for chart widgets: the rebuilt widget produces
//     byte-identical chartProps and byte-identical built SQL — the two artifacts
//     the runtime actually renders/executes.
//
// The test lives in package widget on purpose so it can reach the unexported
// buildChartProps / buildQuery without copying any production logic into it.

func roundTrip(t *testing.T, w WidgetDefinition) WidgetDefinition {
	t.Helper()
	b, err := MarshalWidget(w)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	w2, err := UnmarshalWidget(b)
	if err != nil {
		t.Fatalf("unmarshal (%s): %v", b, err)
	}
	return w2
}

func assertStableJSON(t *testing.T, w WidgetDefinition) []byte {
	t.Helper()
	b1, err := MarshalWidget(w)
	if err != nil {
		t.Fatalf("marshal #1: %v", err)
	}
	w2, err := UnmarshalWidget(b1)
	if err != nil {
		t.Fatalf("unmarshal: %v (json: %s)", err, b1)
	}
	b2, err := MarshalWidget(w2)
	if err != nil {
		t.Fatalf("marshal #2: %v", err)
	}
	if !bytes.Equal(b1, b2) {
		t.Errorf("JSON not stable across round trip:\n #1: %s\n #2: %s", b1, b2)
	}
	return b1
}

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	return b
}

// TestRoundTrip_stableJSON exercises every registered widget type with a
// representative, richly-populated instance.
func TestRoundTrip_stableJSON(t *testing.T) {
	baseQuery := sql.New(sql.From("full_logs"), sql.Where("level = 'error'"))

	cases := map[string]WidgetDefinition{
		"timeBar": NewTimeBar(baseQuery).
			Title("Error / Fatal Logs").Height(150).
			X(sql.AutoBucket("timestamp")).
			Y(sql.Count().WithAlias("logs")).
			Fill(sql.Enum("level")).
			Width(600).MarginLeft(40).
			TipChannels(map[string]string{"level": "Level"}).
			Color(color.ColorLegend(true), color.ColorMapping("error", "#E74C3C")).
			StackOptions(StackOptions{Order: OrderSum, Offset: OffsetExpand, Reverse: true}),
		"timeLine": NewTimeLine(baseQuery).
			Title("Line").Height(200).
			X(sql.AutoBucket("timestamp")).
			Y(sql.Count()).
			Stroke("level"),
		"barVertical": NewBarVertical(baseQuery).
			Title("Bars").Height(200).
			X(sql.Enum("level")).
			Y(sql.Count()).
			Fill(sql.Enum("level")),
		"barHorizontal": NewBarHorizontal(baseQuery).
			Title("Bars").Height(200).
			X(sql.Count()).
			Y(sql.Enum("level")),
		"timeHeatmap": NewTimeHeatmap(baseQuery).
			Title("Heat").
			X(sql.AutoBucket("timestamp")).
			Y(sql.Enum("level")),
		"timeHeatmapOrdinal": NewTimeHeatmapOrdinal(baseQuery).
			Title("Heat").
			X(sql.AutoBucket("timestamp")).
			Y(sql.Enum("level")).
			ColorScheme("reds"),
		"stats": NewStats(baseQuery).
			TitleField(sql.Field("level")).
			FillField(sql.Count()),
		"table": NewTable(baseQuery).Title("Rows").Height(300).Limit(50),
		"markdown": NewMarkdown().
			Content("# Hello").Title("Docs"),
		"grid": NewGrid().
			Template("a a b", "c c b").Gap("1rem").
			Area("a", NewTable(baseQuery).Title("A")).
			Area("b", NewTable(baseQuery).Title("B")),
		"collapsibleGroup": NewCollapsibleGroup().
			Title("Group").Open().
			Widget(NewTable(baseQuery).Title("Inner")),
		"checkboxGroup": NewCheckboxGroup("lvl", "Level", []string{"error", "warn"}).
			Default([]string{"error"}),
		"textInput": NewTextInput("q", "Query").Placeholder("search..."),
	}

	// Every registered type must be represented, so a new widget without a test
	// case fails here rather than silently going unverified.
	for _, wire := range RegisteredWidgetTypes() {
		if len(wire) > 0 && wire[0] == '_' {
			continue // test-only fake widgets registered by registry_test.go
		}
		if _, ok := cases[wire]; !ok {
			t.Errorf("no round-trip case for registered widget %q", wire)
		}
	}

	for name, w := range cases {
		t.Run(name, func(t *testing.T) {
			assertStableJSON(t, w)
		})
	}
}

// TestRoundTrip_chartPropsAndSQL proves semantic equivalence: the rebuilt widget
// renders and queries identically to the original.
func TestRoundTrip_chartPropsAndSQL(t *testing.T) {
	baseQuery := sql.New(sql.From("full_logs"), sql.Where("level = 'error' OR level = 'fatal'"))

	tb := NewTimeBar(baseQuery).
		Title("Error / Fatal Logs").Height(150).
		X(sql.AutoBucket("timestamp")).
		Y(sql.Count().WithAlias("logs")).
		Fill(sql.Enum("level")).
		StackOptions(StackOptions{Order: OrderSum, Reverse: true}).
		Color(color.ColorLegend(true), color.ColorMapping("error", "#E74C3C"))

	tb2, ok := roundTrip(t, tb).(*TimeBar)
	if !ok {
		t.Fatal("round trip did not yield a *TimeBar")
	}

	if got, want := mustJSON(t, tb2.buildChartProps()), mustJSON(t, tb.buildChartProps()); !bytes.Equal(got, want) {
		t.Errorf("chartProps differ after round trip:\n want: %s\n got:  %s", want, got)
	}
	if got, want := tb2.buildQuery().Build(), tb.buildQuery().Build(); got != want {
		t.Errorf("built SQL differs after round trip:\n want: %s\n got:  %s", want, got)
	}
}
