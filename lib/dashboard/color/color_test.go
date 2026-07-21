package color

import (
	"bytes"
	"encoding/json"
	"testing"
)

// TestColorScale_RoundTrip verifies Marshal/UnmarshalJSON are inverses — the
// invariant the widget serializers rely on (docs §4.1).
func TestColorScale_RoundTrip(t *testing.T) {
	orig := New(
		ColorLegend(true),
		ColorMapping("error", "#E74C3C"),
		ColorMapping("warn", "#F39C12"),
		ColorUnknown("#8E44AD"),
		ColorType("categorical"),
		ColorScheme("reds"),
	)

	b1, err := json.Marshal(orig)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var got ColorScale
	if err := json.Unmarshal(b1, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	b2, err := json.Marshal(&got)
	if err != nil {
		t.Fatalf("re-marshal: %v", err)
	}
	if !bytes.Equal(b1, b2) {
		t.Errorf("round trip not stable:\n #1: %s\n #2: %s", b1, b2)
	}
}
