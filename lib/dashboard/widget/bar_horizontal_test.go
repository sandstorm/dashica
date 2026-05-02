package widget

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
)

func TestBarHorizontal_BuildChartProps(t *testing.T) {
	t.Run("Required fields only", func(t *testing.T) {
		bh := NewBarHorizontal(sql.New(sql.From("t"))).
			X(sql.Field("amount").WithAlias("amount")).
			Y(sql.Field("category"))

		props := bh.buildChartProps()
		propsJSON, _ := json.Marshal(props)
		var actual map[string]interface{}
		_ = json.Unmarshal(propsJSON, &actual)

		want := map[string]interface{}{
			"height": float64(200),
			"x":      "amount",
			"y":      "category",
		}
		assertPropsEqual(t, want, actual)
	})

	t.Run("With title, height and fill", func(t *testing.T) {
		bh := NewBarHorizontal(sql.New(sql.From("t"))).
			X(sql.Count()).
			Y(sql.Field("path")).
			Fill(sql.Field("status")).
			Title("Top Paths").
			Height(150)

		props := bh.buildChartProps()
		propsJSON, _ := json.Marshal(props)
		var actual map[string]interface{}
		_ = json.Unmarshal(propsJSON, &actual)

		want := map[string]interface{}{
			"height": float64(150),
			"x":      "cnt",
			"y":      "path",
			"fill":   "status",
			"title":  "Top Paths",
		}
		assertPropsEqual(t, want, actual)
	})
}

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
    timestamp > now() - INTERVAL 1 DAY
GROUP BY
    request_path
ORDER BY
    amount_of_traces desc
LIMIT 5;`

	got := bh.buildQuery().Build()
	if got != want {
		t.Errorf("SQL mismatch\nExpected:\n%s\n\nActual:\n%s\n\nDiff:\n%s",
			want, got, diffStrings(want, got))
	}
}

func TestBarHorizontal_BuildComponents_AutoId(t *testing.T) {
	bh := NewBarHorizontal(sql.New(sql.From("t"))).
		X(sql.Count()).
		Y(sql.Field("category"))

	ctx := &rendering.DashboardContext{CurrentHandlerUrl: "/d"}
	if _, err := bh.BuildComponents(ctx); err != nil {
		t.Fatalf("BuildComponents: %v", err)
	}
	if bh.id == "" {
		t.Error("expected auto-generated id")
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

// renderComponent helper renders a templ.Component to a string for assertion.
func renderComponent(t *testing.T, w WidgetDefinition) string {
	t.Helper()
	ctx := &rendering.DashboardContext{CurrentHandlerUrl: "/d"}
	component, err := w.BuildComponents(ctx)
	if err != nil {
		t.Fatalf("BuildComponents: %v", err)
	}
	var sb strings.Builder
	if err := component.Render(context.Background(), &sb); err != nil {
		t.Fatalf("Render: %v", err)
	}
	return sb.String()
}
