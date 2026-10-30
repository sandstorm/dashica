package widget

import (
	"testing"

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
    (timestamp > now() - INTERVAL 1 DAY)
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
    (timestamp > now() - INTERVAL 1 DAY)
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
    (timestamp > now() - INTERVAL 1 DAY)
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
    (timestamp > now() - INTERVAL 1 DAY)
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
    (timestamp > now() - INTERVAL 1 DAY)
    AND (priority > 5)
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
