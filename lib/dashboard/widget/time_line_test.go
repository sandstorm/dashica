package widget

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/sandstorm/dashica/lib/dashboard/color"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
)

const (
	timeLineTestTableName   = "events"
	timeLineTestWhereClause = "timestamp > now() - INTERVAL 1 DAY"
)

func newTimeLineTestBaseQuery() *sql.SqlQuery {
	return sql.New(
		sql.From(timeLineTestTableName),
		sql.Where(timeLineTestWhereClause),
	)
}

func TestTimeLine_BuildChartProps(t *testing.T) {
	tests := []struct {
		name     string
		setup    func(*TimeLine) *TimeLine
		expected map[string]interface{}
	}{
		{
			name: "Basic configuration with required fields only",
			setup: func(b *TimeLine) *TimeLine {
				return b.X(sql.Timestamp15Min()).
					Y(sql.Count())
			},
			expected: map[string]interface{}{
				"height":      float64(150),
				"x":           "time",
				"xBucketSize": float64(15 * 60 * 1000),
				"y":           "cnt",
			},
		},
		{
			name: "With literal stroke",
			setup: func(b *TimeLine) *TimeLine {
				return b.X(sql.Timestamp15Min()).
					Y(sql.Field("error_rate")).
					Stroke("#ff0000")
			},
			expected: map[string]interface{}{
				"height":      float64(150),
				"x":           "time",
				"xBucketSize": float64(15 * 60 * 1000),
				"y":           "error_rate",
				"stroke":      "#ff0000",
			},
		},
		{
			name: "With field stroke, facets, color, and tooltip channels",
			setup: func(b *TimeLine) *TimeLine {
				return b.X(sql.Timestamp15Min()).
					Y(sql.Field("p95_latency")).
					StrokeField(sql.Field("service")).
					Fx(sql.Field("region")).
					Fy(sql.Field("status")).
					Color(
						color.ColorLegend(true),
						color.ColorMapping("api", "#00ff00"),
						color.ColorUnknown("#cccccc"),
					).
					TipChannels(map[string]string{"Instance": "instance"})
			},
			expected: map[string]interface{}{
				"height":      float64(150),
				"x":           "time",
				"xBucketSize": float64(15 * 60 * 1000),
				"y":           "p95_latency",
				"stroke":      "service",
				"fx":          "region",
				"fy":          "status",
				"color": map[string]interface{}{
					"legend":  true,
					"domain":  []interface{}{"api"},
					"range":   []interface{}{"#00ff00"},
					"unknown": "#cccccc",
				},
				"tip": map[string]interface{}{
					"channels": map[string]interface{}{
						"Instance": "instance",
					},
				},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			widget := NewTimeLine(sql.New(sql.From("test_table")))
			widget = tt.setup(widget)

			props := widget.buildChartProps()
			propsJSON, err := json.Marshal(props)
			if err != nil {
				t.Fatalf("Failed to marshal props: %v", err)
			}

			var actualProps map[string]interface{}
			if err := json.Unmarshal(propsJSON, &actualProps); err != nil {
				t.Fatalf("Failed to unmarshal props: %v", err)
			}

			if !reflect.DeepEqual(tt.expected, actualProps) {
				t.Errorf("Props mismatch\n\nExpected:\n%v\n\nActual:\n%v", tt.expected, actualProps)
			}
		})
	}
}

func TestTimeLine_SQLGeneration(t *testing.T) {
	tests := []struct {
		name        string
		setup       func(*TimeLine) *TimeLine
		expectedSQL string
	}{
		{
			name: "Basic X and Y fields only",
			setup: func(b *TimeLine) *TimeLine {
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
			name: "With stroke field",
			setup: func(b *TimeLine) *TimeLine {
				return b.X(sql.Timestamp15Min()).
					Y(sql.Field("p95_latency")).
					StrokeField(sql.Field("service"))
			},
			expectedSQL: `-- WARNING: This is an auto-generated query file, generated from TODO.
-- DO NOT MODIFY MANUALLY; as changes will be overwritten
SELECT
    service,
    toStartOfFifteenMinutes(timestamp)::DateTime64 AS time,
    p95_latency
FROM
    events
WHERE
    timestamp > now() - INTERVAL 1 DAY
GROUP BY
    time,
    service
ORDER BY
    time,
    service;`,
		},
		{
			name: "With stroke field and facets",
			setup: func(b *TimeLine) *TimeLine {
				return b.X(sql.Timestamp15Min()).
					Y(sql.Field("error_rate")).
					StrokeField(sql.Field("service")).
					Fx(sql.Field("region")).
					Fy(sql.Field("status"))
			},
			expectedSQL: `-- WARNING: This is an auto-generated query file, generated from TODO.
-- DO NOT MODIFY MANUALLY; as changes will be overwritten
SELECT
    status,
    region,
    service,
    toStartOfFifteenMinutes(timestamp)::DateTime64 AS time,
    error_rate
FROM
    events
WHERE
    timestamp > now() - INTERVAL 1 DAY
GROUP BY
    time,
    service,
    region,
    status
ORDER BY
    time,
    service;`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			widget := NewTimeLine(newTimeLineTestBaseQuery())
			widget = tt.setup(widget)

			actualSQL := widget.buildQuery().Build()
			if actualSQL != tt.expectedSQL {
				t.Errorf("SQL mismatch\n\nExpected:\n%s\n\nActual:\n%s\n\nDiff:\n%s",
					tt.expectedSQL,
					actualSQL,
					diffStrings(tt.expectedSQL, actualSQL))
			}
		})
	}
}
