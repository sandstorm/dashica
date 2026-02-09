package widget

import (
	"encoding/json"
	"testing"

	"github.com/sandstorm/dashica/lib/dashboard/color"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
)

// Test constants
const (
	timeBarTestTableName   = "events"
	timeBarTestWhereClause = "timestamp > now() - INTERVAL 1 DAY"
)

// Test helpers
func newTimeBarTestBaseQuery() *sql.SqlQuery {
	return sql.New(
		sql.From(timeBarTestTableName),
		sql.Where(timeBarTestWhereClause),
	)
}

func TestTimeBar_BuildChartProps(t *testing.T) {
	tests := []struct {
		name     string
		setup    func(*TimeBar) *TimeBar
		expected map[string]interface{}
	}{
		{
			name: "Basic configuration with required fields only",
			setup: func(b *TimeBar) *TimeBar {
				return b.X(sql.Timestamp15Min()).
					Y(sql.Count())
			},
			expected: map[string]interface{}{
				"height":      float64(200),
				"x":           "time",
				"xBucketSize": float64(15 * 60 * 1000),
				"y":           "cnt",
			},
		},
		{
			name: "With title",
			setup: func(b *TimeBar) *TimeBar {
				return b.X(sql.Timestamp15Min()).
					Y(sql.Count()).
					Title("Events Over Time")
			},
			expected: map[string]interface{}{
				"height":      float64(200),
				"x":           "time",
				"xBucketSize": float64(15 * 60 * 1000),
				"y":           "cnt",
				"title":       "Events Over Time",
			},
		},
		{
			name: "With custom dimensions",
			setup: func(b *TimeBar) *TimeBar {
				return b.X(sql.Timestamp15Min()).
					Y(sql.Field("revenue")).
					Height(300).
					Width(800)
			},
			expected: map[string]interface{}{
				"height":      float64(300),
				"width":       float64(800),
				"x":           "time",
				"xBucketSize": float64(15 * 60 * 1000),
				"y":           "revenue",
			},
		},
		{
			name: "With all margins",
			setup: func(b *TimeBar) *TimeBar {
				return b.X(sql.Timestamp15Min()).
					Y(sql.Field("sales")).
					MarginLeft(50).
					MarginRight(30).
					MarginTop(20).
					MarginBottom(40)
			},
			expected: map[string]interface{}{
				"height":       float64(200),
				"x":            "time",
				"xBucketSize":  float64(15 * 60 * 1000),
				"y":            "sales",
				"marginLeft":   float64(50),
				"marginRight":  float64(30),
				"marginTop":    float64(20),
				"marginBottom": float64(40),
			},
		},
		{
			name: "With fill field",
			setup: func(b *TimeBar) *TimeBar {
				return b.X(sql.Timestamp15Min()).
					Y(sql.Count()).
					Fill(sql.Field("status"))
			},
			expected: map[string]interface{}{
				"height":      float64(200),
				"x":           "time",
				"xBucketSize": float64(15 * 60 * 1000),
				"y":           "cnt",
				"fill":        "status",
			},
		},
		{
			name: "With fx and fy facets",
			setup: func(b *TimeBar) *TimeBar {
				return b.X(sql.Timestamp15Min()).
					Y(sql.Count()).
					Fx(sql.Field("region")).
					Fy(sql.Field("category"))
			},
			expected: map[string]interface{}{
				"height":      float64(200),
				"x":           "time",
				"xBucketSize": float64(15 * 60 * 1000),
				"y":           "cnt",
				"fx":          "region",
				"fy":          "category",
			},
		},
		{
			name: "With color configuration",
			setup: func(b *TimeBar) *TimeBar {
				return b.X(sql.Timestamp15Min()).
					Y(sql.Field("amount")).
					Color(
						color.ColorLegend(true),
						color.ColorMapping("success", "#00ff00"),
						color.ColorUnknown("#cccccc"),
					)
			},
			expected: map[string]interface{}{
				"height":      float64(200),
				"x":           "time",
				"xBucketSize": float64(15 * 60 * 1000),
				"y":           "amount",
				"color": map[string]interface{}{
					"legend":  true,
					"domain":  []interface{}{"success"},
					"range":   []interface{}{"#00ff00"},
					"unknown": "#cccccc",
				},
			},
		},
		{
			name: "Complex configuration with all optional fields",
			setup: func(b *TimeBar) *TimeBar {
				return b.X(sql.Timestamp15Min()).
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
				"x":            "time",
				"xBucketSize":  float64(15 * 60 * 1000),
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
			widget := NewTimeBar(baseQuery)
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

			assertPropsEqual(t, tt.expected, actualProps)
		})
	}
}

func TestTimeBar_SQLGeneration(t *testing.T) {
	tests := []struct {
		name        string
		setup       func(*TimeBar) *TimeBar
		expectedSQL string
	}{
		{
			name: "Basic X and Y fields only",
			setup: func(b *TimeBar) *TimeBar {
				return b.X(sql.Timestamp15Min()).
					Y(sql.Count())
			},
			expectedSQL: `-- WARNING: This is an auto-generated query file, generated from TODO.
-- DO NOT MODIFY MANUALLY; as changes will be overwritten
SELECT
    toStartOfFifteenMinutes(timestamp)::DateTime64 AS time,
    count(*) AS cnt
FROM
    events
WHERE
    timestamp > now() - INTERVAL 1 DAY
GROUP BY
    time
ORDER BY
    time;`,
		},
		{
			name: "With fill field",
			setup: func(b *TimeBar) *TimeBar {
				return b.X(sql.Timestamp15Min()).
					Y(sql.Count()).
					Fill(sql.Field("status"))
			},
			expectedSQL: `-- WARNING: This is an auto-generated query file, generated from TODO.
-- DO NOT MODIFY MANUALLY; as changes will be overwritten
SELECT
    status,
    toStartOfFifteenMinutes(timestamp)::DateTime64 AS time,
    count(*) AS cnt
FROM
    events
WHERE
    timestamp > now() - INTERVAL 1 DAY
GROUP BY
    time,
    status
ORDER BY
    time,
    status;`,
		},
		{
			name: "With fx field",
			setup: func(b *TimeBar) *TimeBar {
				return b.X(sql.Timestamp15Min()).
					Y(sql.Count()).
					Fx(sql.Field("region"))
			},
			expectedSQL: `-- WARNING: This is an auto-generated query file, generated from TODO.
-- DO NOT MODIFY MANUALLY; as changes will be overwritten
SELECT
    region,
    toStartOfFifteenMinutes(timestamp)::DateTime64 AS time,
    count(*) AS cnt
FROM
    events
WHERE
    timestamp > now() - INTERVAL 1 DAY
GROUP BY
    time,
    region
ORDER BY
    time;`,
		},
		{
			name: "With fy field",
			setup: func(b *TimeBar) *TimeBar {
				return b.X(sql.Timestamp15Min()).
					Y(sql.Count()).
					Fy(sql.Field("category"))
			},
			expectedSQL: `-- WARNING: This is an auto-generated query file, generated from TODO.
-- DO NOT MODIFY MANUALLY; as changes will be overwritten
SELECT
    category,
    toStartOfFifteenMinutes(timestamp)::DateTime64 AS time,
    count(*) AS cnt
FROM
    events
WHERE
    timestamp > now() - INTERVAL 1 DAY
GROUP BY
    time,
    category
ORDER BY
    time;`,
		},
		{
			name: "With fill and fx",
			setup: func(b *TimeBar) *TimeBar {
				return b.X(sql.Timestamp15Min()).
					Y(sql.Count()).
					Fill(sql.Field("product")).
					Fx(sql.Field("region"))
			},
			expectedSQL: `-- WARNING: This is an auto-generated query file, generated from TODO.
-- DO NOT MODIFY MANUALLY; as changes will be overwritten
SELECT
    region,
    product,
    toStartOfFifteenMinutes(timestamp)::DateTime64 AS time,
    count(*) AS cnt
FROM
    events
WHERE
    timestamp > now() - INTERVAL 1 DAY
GROUP BY
    time,
    product,
    region
ORDER BY
    time,
    product;`,
		},
		{
			name: "With fill and fy",
			setup: func(b *TimeBar) *TimeBar {
				return b.X(sql.Timestamp15Min()).
					Y(sql.Count()).
					Fill(sql.Field("status")).
					Fy(sql.Field("team"))
			},
			expectedSQL: `-- WARNING: This is an auto-generated query file, generated from TODO.
-- DO NOT MODIFY MANUALLY; as changes will be overwritten
SELECT
    team,
    status,
    toStartOfFifteenMinutes(timestamp)::DateTime64 AS time,
    count(*) AS cnt
FROM
    events
WHERE
    timestamp > now() - INTERVAL 1 DAY
GROUP BY
    time,
    status,
    team
ORDER BY
    time,
    status;`,
		},
		{
			name: "With fx and fy",
			setup: func(b *TimeBar) *TimeBar {
				return b.X(sql.Timestamp15Min()).
					Y(sql.Count()).
					Fx(sql.Field("region")).
					Fy(sql.Field("category"))
			},
			expectedSQL: `-- WARNING: This is an auto-generated query file, generated from TODO.
-- DO NOT MODIFY MANUALLY; as changes will be overwritten
SELECT
    category,
    region,
    toStartOfFifteenMinutes(timestamp)::DateTime64 AS time,
    count(*) AS cnt
FROM
    events
WHERE
    timestamp > now() - INTERVAL 1 DAY
GROUP BY
    time,
    region,
    category
ORDER BY
    time;`,
		},
		{
			name: "With all optional fields (fill, fx, fy)",
			setup: func(b *TimeBar) *TimeBar {
				return b.X(sql.Timestamp15Min()).
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
    toStartOfFifteenMinutes(timestamp)::DateTime64 AS time,
    count(*) AS cnt
FROM
    events
WHERE
    timestamp > now() - INTERVAL 1 DAY
GROUP BY
    time,
    product,
    region,
    year
ORDER BY
    time,
    product;`,
		},
		{
			name: "With custom timestamped field",
			setup: func(b *TimeBar) *TimeBar {
				return b.X(sql.NewTimestampedFieldAlias("hour_bucket", 3600000)).
					Y(sql.Field("sum(revenue)").WithAlias("total_revenue"))
			},
			expectedSQL: `-- WARNING: This is an auto-generated query file, generated from TODO.
-- DO NOT MODIFY MANUALLY; as changes will be overwritten
SELECT
    hour_bucket,
    sum(revenue) AS total_revenue
FROM
    events
WHERE
    timestamp > now() - INTERVAL 1 DAY
GROUP BY
    hour_bucket
ORDER BY
    hour_bucket;`,
		},
		{
			name: "Complex aggregation with fill and custom fields",
			setup: func(b *TimeBar) *TimeBar {
				return b.X(sql.Timestamp15Min()).
					Y(sql.Field("avg(duration)").WithAlias("avg_duration")).
					Fill(sql.Enum("status"))
			},
			expectedSQL: `-- WARNING: This is an auto-generated query file, generated from TODO.
-- DO NOT MODIFY MANUALLY; as changes will be overwritten
SELECT
    status::String AS status,
    toStartOfFifteenMinutes(timestamp)::DateTime64 AS time,
    avg(duration) AS avg_duration
FROM
    events
WHERE
    timestamp > now() - INTERVAL 1 DAY
GROUP BY
    time,
    status
ORDER BY
    time,
    status;`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			widget := NewTimeBar(newTimeBarTestBaseQuery())
			widget = tt.setup(widget)

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

func TestTimeBar_SQLGeneration_WithAdjustQuery(t *testing.T) {
	tests := []struct {
		name        string
		setup       func(*TimeBar) *TimeBar
		expectedSQL string
	}{
		{
			name: "AdjustQuery adds WHERE clause",
			setup: func(b *TimeBar) *TimeBar {
				return b.X(sql.Timestamp15Min()).
					Y(sql.Count()).
					AdjustQuery(sql.Where("status = 'active'"))
			},
			expectedSQL: `-- WARNING: This is an auto-generated query file, generated from TODO.
-- DO NOT MODIFY MANUALLY; as changes will be overwritten
SELECT
    toStartOfFifteenMinutes(timestamp)::DateTime64 AS time,
    count(*) AS cnt
FROM
    events
WHERE
    timestamp > now() - INTERVAL 1 DAY
    AND status = 'active'
GROUP BY
    time
ORDER BY
    time;`,
		},
		{
			name: "AdjustQuery adds multiple WHERE clauses",
			setup: func(b *TimeBar) *TimeBar {
				return b.X(sql.Timestamp15Min()).
					Y(sql.Count()).
					AdjustQuery(
						sql.Where("status = 'completed'"),
						sql.Where("priority > 5"),
					)
			},
			expectedSQL: `-- WARNING: This is an auto-generated query file, generated from TODO.
-- DO NOT MODIFY MANUALLY; as changes will be overwritten
SELECT
    toStartOfFifteenMinutes(timestamp)::DateTime64 AS time,
    count(*) AS cnt
FROM
    events
WHERE
    timestamp > now() - INTERVAL 1 DAY
    AND status = 'completed'
    AND priority > 5
GROUP BY
    time
ORDER BY
    time;`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			widget := NewTimeBar(newTimeBarTestBaseQuery())
			widget = tt.setup(widget)

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

func TestTimeBar_Immutability(t *testing.T) {
	// Test that the fluent API returns new instances and doesn't mutate the original
	original := NewTimeBar(sql.New(sql.From("test")))

	withX := original.X(sql.Timestamp15Min())
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
	if withX.x == nil || withX.x.Alias() != "time" {
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

func TestTimeBar_BuildComponents(t *testing.T) {
	baseQuery := sql.New(sql.From(timeBarTestTableName))
	widget := NewTimeBar(baseQuery).
		X(sql.Timestamp15Min()).
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

func TestTimeBar_BuildComponents_AutoGeneratesId(t *testing.T) {
	baseQuery := sql.New(sql.From(timeBarTestTableName))
	widget := NewTimeBar(baseQuery).
		X(sql.Timestamp15Min()).
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

	// The widget should have been assigned an ID
	if widget.id == "" {
		t.Error("Expected widget.id to be auto-generated, but it was empty")
	}
}
