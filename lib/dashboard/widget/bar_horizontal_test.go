package widget

import (
	"encoding/json"
	"testing"

	"github.com/sandstorm/dashica/lib/dashboard/sql"
)

func TestBarHorizontal_SQLGeneration(t *testing.T) {
	bh := NewBarHorizontal(newTestBaseQuery()).
		X(sql.Field("sum(cnt)").WithAlias("amount_of_traces")).
		Y(sql.Field("request_path")).
		AdjustQuery(
			sql.OrderBy(sql.Field("amount_of_traces desc")),
			sql.Limit(5),
		)

	want := `-- WARNING: This is an auto-generated query file, generated from TODO.
-- DO NOT MODIFY MANUALLY; as changes will be overwritten
SELECT
    request_path,
    sum(cnt) AS amount_of_traces
FROM
    events
WHERE
    (timestamp > now() - INTERVAL 1 DAY)
GROUP BY
    request_path
ORDER BY
    amount_of_traces desc
LIMIT 5;`

	got := bh.Query().Build()
	if got != want {
		t.Errorf("SQL mismatch\nExpected:\n%s\n\nActual:\n%s\n\nDiff:\n%s",
			want, got, diffStrings(want, got))
	}
}

func TestBarHorizontal_Immutability(t *testing.T) {
	original := NewBarHorizontal(sql.New(sql.From("t")))
	withX := original.X(sql.Field("a"))
	if original.x != nil {
		t.Error("original mutated by X()")
	}
	if withX.x == nil {
		t.Error("clone missing x")
	}
}

// Regression: an optional *SqlField (fill) sent as JSON null must unmarshal to a
// nil pointer, not a non-nil pointer wrapping a nil interface. The editor emits
// `"fill": null` when the user switches Fill back to "(none)"; the old generated
// unmarshal did `r.fill = &f` unconditionally, so `b.fill != nil` was true and
// Query dereferenced the nil interface (panic seen as
// "preview render: widget is incomplete or invalid (nil pointer dereference)").
func TestBarHorizontal_FillNullUnmarshalsToNil(t *testing.T) {
	jsonIn := `{"sql":{"kind":"table","table":"events"},` +
		`"x":{"kind":"count","definition":"count(*)","alias":"cnt"},` +
		`"y":{"kind":"enum","definition":"path::String","alias":"path"},` +
		`"fill":null,"height":200}`

	var bh BarHorizontal
	if err := json.Unmarshal([]byte(jsonIn), &bh); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if bh.fill != nil {
		t.Fatalf("fill should be nil for JSON null, got non-nil pointer wrapping %v", *bh.fill)
	}

	// Must not panic (the reported bug).
	_ = bh.Query().Build()
}
