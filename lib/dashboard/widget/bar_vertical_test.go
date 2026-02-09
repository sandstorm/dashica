package widget

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/sandstorm/dashica/lib/dashboard/color"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
)

func TestBarVertical_BuildChartProps(t *testing.T) {
	tests := []struct {
		name     string
		setup    func(*BarVertical) *BarVertical
		expected map[string]interface{}
	}{
		{
			name: "Basic configuration with required fields only",
			setup: func(b *BarVertical) *BarVertical {
				return b.X(sql.Field("category")).
					Y(sql.Count())
			},
			expected: map[string]interface{}{
				"height": float64(200),
				"x":      "category",
				"y":      "cnt",
			},
		},
		{
			name: "With title",
			setup: func(b *BarVertical) *BarVertical {
				return b.X(sql.Field("category")).
					Y(sql.Count()).
					Title("Sales by Category")
			},
			expected: map[string]interface{}{
				"height": float64(200),
				"x":      "category",
				"y":      "cnt",
				"title":  "Sales by Category",
			},
		},
		{
			name: "With custom dimensions",
			setup: func(b *BarVertical) *BarVertical {
				return b.X(sql.Field("month")).
					Y(sql.Field("revenue")).
					Height(300).
					Width(800)
			},
			expected: map[string]interface{}{
				"height": float64(300),
				"width":  float64(800),
				"x":      "month",
				"y":      "revenue",
			},
		},
		{
			name: "With all margins",
			setup: func(b *BarVertical) *BarVertical {
				return b.X(sql.Field("product")).
					Y(sql.Field("sales")).
					MarginLeft(50).
					MarginRight(30).
					MarginTop(20).
					MarginBottom(40)
			},
			expected: map[string]interface{}{
				"height":       float64(200),
				"x":            "product",
				"y":            "sales",
				"marginLeft":   float64(50),
				"marginRight":  float64(30),
				"marginTop":    float64(20),
				"marginBottom": float64(40),
			},
		},
		{
			name: "With fill field",
			setup: func(b *BarVertical) *BarVertical {
				return b.X(sql.Field("date")).
					Y(sql.Count()).
					Fill(sql.Field("status"))
			},
			expected: map[string]interface{}{
				"height": float64(200),
				"x":      "date",
				"y":      "cnt",
				"fill":   "status",
			},
		},
		{
			name: "With fx and fy facets",
			setup: func(b *BarVertical) *BarVertical {
				return b.X(sql.Field("hour")).
					Y(sql.Count()).
					Fx(sql.Field("region")).
					Fy(sql.Field("category"))
			},
			expected: map[string]interface{}{
				"height": float64(200),
				"x":      "hour",
				"y":      "cnt",
				"fx":     "region",
				"fy":     "category",
			},
		},
		{
			name: "With color configuration",
			setup: func(b *BarVertical) *BarVertical {
				return b.X(sql.Field("product")).
					Y(sql.Field("amount")).
					Color(
						color.ColorLegend(true),
						color.ColorMapping("A", "#ff0000"),
						color.ColorUnknown("#cccccc"),
					)
			},
			expected: map[string]interface{}{
				"height": float64(200),
				"x":      "product",
				"y":      "amount",
				"color": map[string]interface{}{
					"legend":  true,
					"domain":  []interface{}{"A"},
					"range":   []interface{}{"#ff0000"},
					"unknown": "#cccccc",
				},
			},
		},
		{
			name: "Complex configuration with all optional fields",
			setup: func(b *BarVertical) *BarVertical {
				return b.X(sql.Field("month")).
					Y(sql.Field("revenue")).
					Fill(sql.Field("category")).
					Fx(sql.Field("region")).
					Fy(sql.Field("year")).
					Title("Revenue Analysis").
					Height(400).
					Width(1200).
					MarginLeft(60).
					MarginRight(40).
					MarginTop(30).
					MarginBottom(50).
					Color(
						color.ColorLegend(false),
						color.ColorUnknown("#999999"),
					)
			},
			expected: map[string]interface{}{
				"height":       float64(400),
				"width":        float64(1200),
				"x":            "month",
				"y":            "revenue",
				"fill":         "category",
				"fx":           "region",
				"fy":           "year",
				"title":        "Revenue Analysis",
				"marginLeft":   float64(60),
				"marginRight":  float64(40),
				"marginTop":    float64(30),
				"marginBottom": float64(50),
				"color": map[string]interface{}{
					"legend":  false,
					"unknown": "#999999",
				},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			baseQuery := sql.New(sql.From("test_table"))
			widget := NewBarVertical(baseQuery)
			widget = tt.setup(widget)

			props := widget.buildChartProps()

			// Convert to JSON and back to normalize types
			propsJSON, err := json.Marshal(props)
			if err != nil {
				t.Fatalf("Failed to marshal props: %v", err)
			}

			var actualProps map[string]interface{}
			if err := json.Unmarshal(propsJSON, &actualProps); err != nil {
				t.Fatalf("Failed to unmarshal props: %v", err)
			}

			// Check that all expected fields are present
			for key, expectedValue := range tt.expected {
				actualValue, exists := actualProps[key]
				if !exists {
					t.Errorf("Expected key %q to be present in props", key)
					continue
				}

				// Deep comparison for nested maps (color)
				if expectedMap, ok := expectedValue.(map[string]interface{}); ok {
					actualMap, ok := actualValue.(map[string]interface{})
					if !ok {
						t.Errorf("Expected %q to be a map, got %T", key, actualValue)
						continue
					}
					for subKey, subExpected := range expectedMap {
						actualSubValue := actualMap[subKey]

						// Compare arrays
						if expectedArray, ok := subExpected.([]interface{}); ok {
							actualArray, ok := actualSubValue.([]interface{})
							if !ok {
								t.Errorf("For %q.%q: expected array, got %T", key, subKey, actualSubValue)
								continue
							}
							if len(actualArray) != len(expectedArray) {
								t.Errorf("For %q.%q: expected array length %d, got %d", key, subKey, len(expectedArray), len(actualArray))
								continue
							}
							for i, expItem := range expectedArray {
								if actualArray[i] != expItem {
									t.Errorf("For %q.%q[%d]: expected %v, got %v", key, subKey, i, expItem, actualArray[i])
								}
							}
						} else if actualSubValue != subExpected {
							t.Errorf("For %q.%q: expected %v, got %v", key, subKey, subExpected, actualSubValue)
						}
					}
				} else if actualValue != expectedValue {
					t.Errorf("For %q: expected %v, got %v", key, expectedValue, actualValue)
				}
			}

			// Check that no unexpected fields are present (except color which can have defaults)
			for key := range actualProps {
				if _, expected := tt.expected[key]; !expected {
					t.Errorf("Unexpected key %q in props with value %v", key, actualProps[key])
				}
			}
		})
	}
}

func TestBarVertical_SQLGeneration(t *testing.T) {
	tests := []struct {
		name        string
		setup       func(*BarVertical) *BarVertical
		expectedSQL string
	}{
		{
			name: "Basic X and Y fields only",
			setup: func(b *BarVertical) *BarVertical {
				return b.X(sql.Field("category")).
					Y(sql.Count())
			},
			expectedSQL: `-- WARNING: This is an auto-generated query file, generated from TODO.
-- DO NOT MODIFY MANUALLY; as changes will be overwritten
SELECT
    category,
    count(*) AS cnt
FROM
    events
WHERE
    timestamp > now() - INTERVAL 1 DAY
GROUP BY
    category;`,
		},
		{
			name: "With fill field",
			setup: func(b *BarVertical) *BarVertical {
				return b.X(sql.Field("date")).
					Y(sql.Count()).
					Fill(sql.Field("status"))
			},
			expectedSQL: `-- WARNING: This is an auto-generated query file, generated from TODO.
-- DO NOT MODIFY MANUALLY; as changes will be overwritten
SELECT
    status,
    date,
    count(*) AS cnt
FROM
    events
WHERE
    timestamp > now() - INTERVAL 1 DAY
GROUP BY
    date,
    status;`,
		},
		{
			name: "With fx field",
			setup: func(b *BarVertical) *BarVertical {
				return b.X(sql.Field("hour")).
					Y(sql.Count()).
					Fx(sql.Field("region"))
			},
			expectedSQL: `-- WARNING: This is an auto-generated query file, generated from TODO.
-- DO NOT MODIFY MANUALLY; as changes will be overwritten
SELECT
    region,
    hour,
    count(*) AS cnt
FROM
    events
WHERE
    timestamp > now() - INTERVAL 1 DAY
GROUP BY
    hour,
    region;`,
		},
		{
			name: "With fy field",
			setup: func(b *BarVertical) *BarVertical {
				return b.X(sql.Field("day")).
					Y(sql.Count()).
					Fy(sql.Field("category"))
			},
			expectedSQL: `-- WARNING: This is an auto-generated query file, generated from TODO.
-- DO NOT MODIFY MANUALLY; as changes will be overwritten
SELECT
    category,
    day,
    count(*) AS cnt
FROM
    events
WHERE
    timestamp > now() - INTERVAL 1 DAY
GROUP BY
    day,
    category;`,
		},
		{
			name: "With fill and fx",
			setup: func(b *BarVertical) *BarVertical {
				return b.X(sql.Field("month")).
					Y(sql.Count()).
					Fill(sql.Field("product")).
					Fx(sql.Field("region"))
			},
			expectedSQL: `-- WARNING: This is an auto-generated query file, generated from TODO.
-- DO NOT MODIFY MANUALLY; as changes will be overwritten
SELECT
    region,
    product,
    month,
    count(*) AS cnt
FROM
    events
WHERE
    timestamp > now() - INTERVAL 1 DAY
GROUP BY
    month,
    product,
    region;`,
		},
		{
			name: "With fill and fy",
			setup: func(b *BarVertical) *BarVertical {
				return b.X(sql.Field("week")).
					Y(sql.Count()).
					Fill(sql.Field("status")).
					Fy(sql.Field("team"))
			},
			expectedSQL: `-- WARNING: This is an auto-generated query file, generated from TODO.
-- DO NOT MODIFY MANUALLY; as changes will be overwritten
SELECT
    team,
    status,
    week,
    count(*) AS cnt
FROM
    events
WHERE
    timestamp > now() - INTERVAL 1 DAY
GROUP BY
    week,
    status,
    team;`,
		},
		{
			name: "With fx and fy",
			setup: func(b *BarVertical) *BarVertical {
				return b.X(sql.Field("day")).
					Y(sql.Count()).
					Fx(sql.Field("region")).
					Fy(sql.Field("category"))
			},
			expectedSQL: `-- WARNING: This is an auto-generated query file, generated from TODO.
-- DO NOT MODIFY MANUALLY; as changes will be overwritten
SELECT
    category,
    region,
    day,
    count(*) AS cnt
FROM
    events
WHERE
    timestamp > now() - INTERVAL 1 DAY
GROUP BY
    day,
    region,
    category;`,
		},
		{
			name: "With all optional fields (fill, fx, fy)",
			setup: func(b *BarVertical) *BarVertical {
				return b.X(sql.Field("month")).
					Y(sql.Count()).
					Fill(sql.Field("product")).
					Fx(sql.Field("region")).
					Fy(sql.Field("year"))
			},
			expectedSQL: `-- WARNING: This is an auto-generated query file, generated from TODO.
-- DO NOT MODIFY MANUALLY; as changes will be overwritten
SELECT
    year,
    region,
    product,
    month,
    count(*) AS cnt
FROM
    events
WHERE
    timestamp > now() - INTERVAL 1 DAY
GROUP BY
    month,
    product,
    region,
    year;`,
		},
		{
			name: "With custom field definitions and aliases",
			setup: func(b *BarVertical) *BarVertical {
				return b.X(sql.Field("toStartOfDay(timestamp)").WithAlias("day")).
					Y(sql.Field("sum(revenue)").WithAlias("total_revenue"))
			},
			expectedSQL: `-- WARNING: This is an auto-generated query file, generated from TODO.
-- DO NOT MODIFY MANUALLY; as changes will be overwritten
SELECT
    toStartOfDay(timestamp) AS day,
    sum(revenue) AS total_revenue
FROM
    events
WHERE
    timestamp > now() - INTERVAL 1 DAY
GROUP BY
    day;`,
		},
		{
			name: "Complex aggregation with fill and custom fields",
			setup: func(b *BarVertical) *BarVertical {
				return b.X(sql.Field("toStartOfHour(timestamp)").WithAlias("hour")).
					Y(sql.Field("avg(duration)").WithAlias("avg_duration")).
					Fill(sql.Enum("status"))
			},
			expectedSQL: `-- WARNING: This is an auto-generated query file, generated from TODO.
-- DO NOT MODIFY MANUALLY; as changes will be overwritten
SELECT
    status::String AS status,
    toStartOfHour(timestamp) AS hour,
    avg(duration) AS avg_duration
FROM
    events
WHERE
    timestamp > now() - INTERVAL 1 DAY
GROUP BY
    hour,
    status;`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			baseQuery := sql.New(
				sql.From("events"),
				sql.Where("timestamp > now() - INTERVAL 1 DAY"),
			)
			widget := NewBarVertical(baseQuery)
			widget = tt.setup(widget)

			// Build the query using the actual implementation
			query := widget.buildQuery()
			actualSQL := query.Build()

			if actualSQL != tt.expectedSQL {
				t.Errorf("SQL mismatch\n\nExpected:\n%s\n\nActual:\n%s\n\nDiff:\n%s",
					tt.expectedSQL,
					actualSQL,
					diffStrings(tt.expectedSQL, actualSQL))
			}
		})
	}
}

// diffStrings provides a simple line-by-line diff for better error messages
func diffStrings(expected, actual string) string {
	expLines := strings.Split(expected, "\n")
	actLines := strings.Split(actual, "\n")

	var diff strings.Builder
	maxLines := len(expLines)
	if len(actLines) > maxLines {
		maxLines = len(actLines)
	}

	for i := 0; i < maxLines; i++ {
		var expLine, actLine string
		if i < len(expLines) {
			expLine = expLines[i]
		}
		if i < len(actLines) {
			actLine = actLines[i]
		}

		if expLine != actLine {
			diff.WriteString(fmt.Sprintf("Line %d:\n", i+1))
			diff.WriteString(fmt.Sprintf("  - %s\n", expLine))
			diff.WriteString(fmt.Sprintf("  + %s\n", actLine))
		}
	}

	if diff.Len() == 0 {
		return "(strings are equal)"
	}
	return diff.String()
}

func TestBarVertical_SQLGeneration_WithAdjustQuery(t *testing.T) {
	tests := []struct {
		name        string
		setup       func(*BarVertical) *BarVertical
		expectedSQL string
	}{
		{
			name: "AdjustQuery adds WHERE clause",
			setup: func(b *BarVertical) *BarVertical {
				return b.X(sql.Field("category")).
					Y(sql.Count()).
					AdjustQuery(sql.Where("status = 'active'"))
			},
			expectedSQL: `-- WARNING: This is an auto-generated query file, generated from TODO.
-- DO NOT MODIFY MANUALLY; as changes will be overwritten
SELECT
    category,
    count(*) AS cnt
FROM
    events
WHERE
    timestamp > now() - INTERVAL 1 DAY
    AND status = 'active'
GROUP BY
    category;`,
		},
		{
			name: "AdjustQuery adds multiple WHERE clauses",
			setup: func(b *BarVertical) *BarVertical {
				return b.X(sql.Field("day")).
					Y(sql.Count()).
					AdjustQuery(
						sql.Where("status = 'completed'"),
						sql.Where("priority > 5"),
					)
			},
			expectedSQL: `-- WARNING: This is an auto-generated query file, generated from TODO.
-- DO NOT MODIFY MANUALLY; as changes will be overwritten
SELECT
    day,
    count(*) AS cnt
FROM
    events
WHERE
    timestamp > now() - INTERVAL 1 DAY
    AND status = 'completed'
    AND priority > 5
GROUP BY
    day;`,
		},
		{
			name: "AdjustQuery adds ORDER BY",
			setup: func(b *BarVertical) *BarVertical {
				return b.X(sql.Field("product")).
					Y(sql.Count()).
					AdjustQuery(sql.OrderBy(sql.Count()))
			},
			expectedSQL: `-- WARNING: This is an auto-generated query file, generated from TODO.
-- DO NOT MODIFY MANUALLY; as changes will be overwritten
SELECT
    product,
    count(*) AS cnt
FROM
    events
WHERE
    timestamp > now() - INTERVAL 1 DAY
GROUP BY
    product
ORDER BY
    cnt;`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			baseQuery := sql.New(
				sql.From("events"),
				sql.Where("timestamp > now() - INTERVAL 1 DAY"),
			)
			widget := NewBarVertical(baseQuery)
			widget = tt.setup(widget)

			// Build the query using the actual implementation
			query := widget.buildQuery()
			actualSQL := query.Build()

			if actualSQL != tt.expectedSQL {
				t.Errorf("SQL mismatch\n\nExpected:\n%s\n\nActual:\n%s\n\nDiff:\n%s",
					tt.expectedSQL,
					actualSQL,
					diffStrings(tt.expectedSQL, actualSQL))
			}
		})
	}
}

func TestBarVertical_Immutability(t *testing.T) {
	// Test that the fluent API returns new instances and doesn't mutate the original
	original := NewBarVertical(sql.New(sql.From("test")))

	withX := original.X(sql.Field("x1"))
	withY := withX.Y(sql.Field("y1"))
	withTitle := withY.Title("Test")

	// Original should be unchanged
	if original.x != nil {
		t.Error("Original widget was mutated after X() call")
	}
	if original.y != nil {
		t.Error("Original widget was mutated after Y() call")
	}

	// WithX should have x but not y
	if withX.x == nil || withX.x.Alias() != "x1" {
		t.Error("X not set correctly")
	}
	if withX.y != nil {
		t.Error("WithX should not have y")
	}

	// WithY should have both x and y but no title
	if withY.x == nil || withY.y == nil {
		t.Error("X or Y lost after Y() call")
	}
	if withY.title != "" {
		t.Error("WithY should not have a title")
	}

	// WithTitle should have all three
	if withTitle.x == nil || withTitle.y == nil || withTitle.title != "Test" {
		t.Error("Fields lost or title not set correctly")
	}
}

func TestBarVertical_BuildComponents(t *testing.T) {
	baseQuery := sql.New(sql.From("events"))
	widget := NewBarVertical(baseQuery).
		X(sql.Field("category")).
		Y(sql.Count()).
		Title("Test Chart").
		Id("test-widget-123")

	ctx := &rendering.DashboardContext{
		CurrentHandlerUrl: "/dashboard",
	}

	component, err := widget.BuildComponents(ctx)
	if err != nil {
		t.Fatalf("BuildComponents failed: %v", err)
	}

	if component == nil {
		t.Error("Expected non-nil component")
	}
}

func TestBarVertical_BuildComponents_AutoGeneratesId(t *testing.T) {
	baseQuery := sql.New(sql.From("events"))
	widget := NewBarVertical(baseQuery).
		X(sql.Field("category")).
		Y(sql.Count())

	ctx := &rendering.DashboardContext{
		CurrentHandlerUrl: "/dashboard",
	}

	// Widget should auto-generate an ID
	component, err := widget.BuildComponents(ctx)
	if err != nil {
		t.Fatalf("BuildComponents failed: %v", err)
	}

	if component == nil {
		t.Error("Expected non-nil component")
	}

	// The widget should have been assigned an ID (starts at 1)
	if widget.id == "" {
		t.Error("Expected widget.id to be auto-generated, but it was empty")
	}
}

