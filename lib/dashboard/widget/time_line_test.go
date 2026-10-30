package widget

import (
	"testing"

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
    (timestamp > now() - INTERVAL 1 DAY)
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
    (timestamp > now() - INTERVAL 1 DAY)
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
    (timestamp > now() - INTERVAL 1 DAY)
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

			actualSQL := widget.Query().Build()
			if actualSQL != tt.expectedSQL {
				t.Errorf("SQL mismatch\n\nExpected:\n%s\n\nActual:\n%s\n\nDiff:\n%s",
					tt.expectedSQL,
					actualSQL,
					diffStrings(tt.expectedSQL, actualSQL))
			}
		})
	}
}
