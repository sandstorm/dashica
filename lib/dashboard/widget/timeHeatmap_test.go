package widget

import (
	"encoding/json"
	"testing"

	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
)

// Test constants
const (
	timeHeatmapTestTableName   = "events"
	timeHeatmapTestWhereClause = "timestamp > now() - INTERVAL 1 DAY"
)

// Test helpers
func newTimeHeatmapTestBaseQuery() *sql.SqlQuery {
	return sql.New(
		sql.From(timeHeatmapTestTableName),
		sql.Where(timeHeatmapTestWhereClause),
	)
}

func TestTimeHeatmap_BuildChartProps(t *testing.T) {
	tests := []struct {
		name     string
		setup    func(*TimeHeatmap) *TimeHeatmap
		expected map[string]interface{}
	}{
		{
			name: "Basic configuration with required fields only",
			setup: func(h *TimeHeatmap) *TimeHeatmap {
				return h.X(sql.Timestamp15Min()).
					Y(sql.Field("status")).
					YBucketSize(1000)
			},
			expected: map[string]interface{}{
				"x":           "time",
				"xBucketSize": float64(15 * 60 * 1000),
				"y":           "status",
				"yBucketSize": float64(1000),
			},
		},
		{
			name: "With title",
			setup: func(h *TimeHeatmap) *TimeHeatmap {
				return h.X(sql.Timestamp15Min()).
					Y(sql.Field("category")).
					YBucketSize(500).
					Title("Event Heatmap")
			},
			expected: map[string]interface{}{
				"x":           "time",
				"xBucketSize": float64(15 * 60 * 1000),
				"y":           "category",
				"yBucketSize": float64(500),
				"title":       "Event Heatmap",
			},
		},
		{
			name: "With custom dimensions",
			setup: func(h *TimeHeatmap) *TimeHeatmap {
				return h.X(sql.Timestamp15Min()).
					Y(sql.Field("bucket")).
					YBucketSize(100).
					Height(400).
					Width(800)
			},
			expected: map[string]interface{}{
				"x":           "time",
				"xBucketSize": float64(15 * 60 * 1000),
				"y":           "bucket",
				"yBucketSize": float64(100),
				"height":      float64(400),
				"width":       float64(800),
			},
		},
		{
			name: "With margin",
			setup: func(h *TimeHeatmap) *TimeHeatmap {
				return h.X(sql.Timestamp15Min()).
					Y(sql.Field("value")).
					YBucketSize(250).
					MarginLeft(60)
			},
			expected: map[string]interface{}{
				"x":           "time",
				"xBucketSize": float64(15 * 60 * 1000),
				"y":           "value",
				"yBucketSize": float64(250),
				"marginLeft":  float64(60),
			},
		},
		{
			name: "With fill field",
			setup: func(h *TimeHeatmap) *TimeHeatmap {
				return h.X(sql.Timestamp15Min()).
					Y(sql.Field("level")).
					YBucketSize(100).
					Fill(sql.Count())
			},
			expected: map[string]interface{}{
				"x":           "time",
				"xBucketSize": float64(15 * 60 * 1000),
				"y":           "level",
				"yBucketSize": float64(100),
				"fill":        "cnt",
			},
		},
		{
			name: "Complex configuration with all optional fields",
			setup: func(h *TimeHeatmap) *TimeHeatmap {
				return h.X(sql.Timestamp15Min()).
					Y(sql.Field("category")).
					YBucketSize(200).
					Fill(sql.Field("sum(value)").WithAlias("total")).
					Title("Activity Heatmap").
					Height(500).
					Width(1000).
					MarginLeft(80)
			},
			expected: map[string]interface{}{
				"x":           "time",
				"xBucketSize": float64(15 * 60 * 1000),
				"y":           "category",
				"yBucketSize": float64(200),
				"fill":        "total",
				"title":       "Activity Heatmap",
				"height":      float64(500),
				"width":       float64(1000),
				"marginLeft":  float64(80),
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			baseQuery := sql.New(sql.From("test_table"))
			widget := NewTimeHeatmap(baseQuery)
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

func TestTimeHeatmap_SQLGeneration(t *testing.T) {
	tests := []struct {
		name        string
		setup       func(*TimeHeatmap) *TimeHeatmap
		expectedSQL string
	}{
		{
			name: "Basic X and Y fields only",
			setup: func(h *TimeHeatmap) *TimeHeatmap {
				return h.X(sql.Timestamp15Min()).
					Y(sql.Field("status")).
					YBucketSize(100)
			},
			expectedSQL: `-- WARNING: This is an auto-generated query file, generated from TODO.
-- DO NOT MODIFY MANUALLY; as changes will be overwritten
SELECT
    status,
    toStartOfFifteenMinutes(timestamp)::DateTime64 AS time
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
			name: "With fill field",
			setup: func(h *TimeHeatmap) *TimeHeatmap {
				return h.X(sql.Timestamp15Min()).
					Y(sql.Field("category")).
					YBucketSize(50).
					Fill(sql.Count())
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
    time,
    category;`,
		},
		{
			name: "With custom aggregation fill",
			setup: func(h *TimeHeatmap) *TimeHeatmap {
				return h.X(sql.Timestamp15Min()).
					Y(sql.Field("bucket")).
					YBucketSize(75).
					Fill(sql.Field("avg(duration)").WithAlias("avg_duration"))
			},
			expectedSQL: `-- WARNING: This is an auto-generated query file, generated from TODO.
-- DO NOT MODIFY MANUALLY; as changes will be overwritten
SELECT
    bucket,
    toStartOfFifteenMinutes(timestamp)::DateTime64 AS time,
    avg(duration) AS avg_duration
FROM
    events
WHERE
    timestamp > now() - INTERVAL 1 DAY
GROUP BY
    time,
    bucket
ORDER BY
    time,
    bucket;`,
		},
		{
			name: "With custom timestamped field",
			setup: func(h *TimeHeatmap) *TimeHeatmap {
				return h.X(sql.NewTimestampedFieldAlias("hour_bucket", 3600000)).
					Y(sql.Field("level")).
					YBucketSize(10)
			},
			expectedSQL: `-- WARNING: This is an auto-generated query file, generated from TODO.
-- DO NOT MODIFY MANUALLY; as changes will be overwritten
SELECT
    level,
    hour_bucket
FROM
    events
WHERE
    timestamp > now() - INTERVAL 1 DAY
GROUP BY
    hour_bucket,
    level
ORDER BY
    hour_bucket,
    level;`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			widget := NewTimeHeatmap(newTimeHeatmapTestBaseQuery())
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

func TestTimeHeatmap_SQLGeneration_WithAdjustQuery(t *testing.T) {
	tests := []struct {
		name        string
		setup       func(*TimeHeatmap) *TimeHeatmap
		expectedSQL string
	}{
		{
			name: "AdjustQuery adds WHERE clause",
			setup: func(h *TimeHeatmap) *TimeHeatmap {
				return h.X(sql.Timestamp15Min()).
					Y(sql.Field("status")).
					YBucketSize(100).
					AdjustQuery(sql.Where("priority > 5"))
			},
			expectedSQL: `-- WARNING: This is an auto-generated query file, generated from TODO.
-- DO NOT MODIFY MANUALLY; as changes will be overwritten
SELECT
    status,
    toStartOfFifteenMinutes(timestamp)::DateTime64 AS time
FROM
    events
WHERE
    timestamp > now() - INTERVAL 1 DAY
    AND priority > 5
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
			widget := NewTimeHeatmap(newTimeHeatmapTestBaseQuery())
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

func TestTimeHeatmap_Immutability(t *testing.T) {
	// Test that the fluent API returns new instances and doesn't mutate the original
	original := NewTimeHeatmap(sql.New(sql.From("test")))

	withX := original.X(sql.Timestamp15Min())
	withY := withX.Y(sql.Field("y1"))
	withYBucket := withY.YBucketSize(100)

	// Original should be unchanged
	if original.x != nil {
		t.Error("Original widget was mutated after X() call")
	}
	if original.y != nil {
		t.Error("Original widget was mutated after Y() call")
	}
	if original.yBucketSize != 0 {
		t.Error("Original widget was mutated after YBucketSize() call")
	}

	// Check intermediate states
	if withX.x == nil {
		t.Error("X not set correctly")
	}
	if withY.y == nil {
		t.Error("Y not set correctly")
	}
	if withYBucket.yBucketSize != 100 {
		t.Error("YBucketSize not set correctly")
	}
}

func TestTimeHeatmap_BuildComponents(t *testing.T) {
	baseQuery := sql.New(sql.From(timeHeatmapTestTableName))
	widget := NewTimeHeatmap(baseQuery).
		X(sql.Timestamp15Min()).
		Y(sql.Field("status")).
		YBucketSize(100).
		Title("Test Heatmap").
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

func TestTimeHeatmap_BuildComponents_AutoGeneratesId(t *testing.T) {
	baseQuery := sql.New(sql.From(timeHeatmapTestTableName))
	widget := NewTimeHeatmap(baseQuery).
		X(sql.Timestamp15Min()).
		Y(sql.Field("status")).
		YBucketSize(100)

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

	if widget.id == "" {
		t.Error("Expected widget.id to be auto-generated, but it was empty")
	}
}
