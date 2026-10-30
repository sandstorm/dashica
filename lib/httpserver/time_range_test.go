package httpserver

import (
	"strconv"
	"testing"
	"time"
)

func TestParseTimeExpr(t *testing.T) {
	now := time.Date(2026, 10, 29, 12, 0, 0, 0, time.Local)
	tests := map[string]struct {
		text string
		want time.Time
	}{
		"now":                {text: "now", want: now},
		"seconds ago":        {text: "now-30s", want: now.Add(-30 * time.Second)},
		"minutes ago":        {text: "now-15m", want: now.Add(-15 * time.Minute)},
		"hours ago":          {text: "now-6h", want: now.Add(-6 * time.Hour)},
		"days ago":           {text: "now-2d", want: now.AddDate(0, 0, -2)},
		"weeks ago":          {text: "now-1w", want: now.AddDate(0, 0, -7)},
		"ahead":              {text: "now+1h", want: now.Add(time.Hour)},
		"absolute":           {text: "2026-10-29 10:00", want: time.Date(2026, 10, 29, 10, 0, 0, 0, time.Local)},
		"surrounding spaces": {text: " now-1h ", want: now.Add(-time.Hour)},
	}
	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			got, err := parseTimeExpr(tt.text, now)
			if err != nil {
				t.Fatalf("parseTimeExpr(%q): %v", tt.text, err)
			}
			if !got.Equal(tt.want) {
				t.Errorf("parseTimeExpr(%q) = %v, want %v", tt.text, got, tt.want)
			}
		})
	}
}

func TestParseTimeExpr_RejectsWhatItDoesNotKnow(t *testing.T) {
	now := time.Now()
	for _, text := range []string{"", "yesterday", "now-6", "now-6y", "now-h", "2026-10-29", "2026-10-29T10:00", "now()-1h"} {
		if _, err := parseTimeExpr(text, now); err == nil {
			t.Errorf("parseTimeExpr(%q): want an error", text)
		}
	}
}

func TestSqlClause_PresetIsAnyGoDuration(t *testing.T) {
	tests := map[string]string{
		"1h":   "timestamp >= (now() - INTERVAL 3600 SECOND) AND timestamp <= (now())",
		"90m":  "timestamp >= (now() - INTERVAL 5400 SECOND) AND timestamp <= (now())",
		"168h": "timestamp >= (now() - INTERVAL 604800 SECOND) AND timestamp <= (now())",
	}
	for timeRange, want := range tests {
		f := DashboardFilters{TimeRange: timeRange}
		if got := f.SqlClause(); got != want {
			t.Errorf("SqlClause(%q) = %q, want %q", timeRange, got, want)
		}
	}
}

func TestSqlClause_CustomRange(t *testing.T) {
	from := time.Date(2026, 10, 29, 10, 0, 0, 0, time.Local)
	to := time.Date(2026, 10, 29, 12, 0, 0, 0, time.Local)
	f := DashboardFilters{TimeRange: "custom", CustomTimeRange: "2026-10-29 10:00 to 2026-10-29 12:00", SqlFilter: "status >= 500"}
	want := "timestamp >= " + strconv.FormatInt(from.Unix(), 10) + " AND timestamp <= " + strconv.FormatInt(to.Unix(), 10) + " AND (status >= 500)"
	if got := f.SqlClause(); got != want {
		t.Errorf("SqlClause = %q, want %q", got, want)
	}
}

func TestSqlClause_CustomRangeRelativeToNow(t *testing.T) {
	f := DashboardFilters{TimeRange: "custom", CustomTimeRange: "now-6h to now-1h"}
	f.SqlClause()
	from, to := time.Unix(int64(f.From.(float64)), 0), time.Unix(int64(f.To.(float64)), 0)
	if got := to.Sub(from); got != 5*time.Hour {
		t.Errorf("window = %v, want 5h", got)
	}
	if ago := time.Since(to); ago < time.Hour-time.Minute || ago > time.Hour+time.Minute {
		t.Errorf("end = %v ago, want 1h", ago)
	}
}

func TestSqlClause_InvalidCustomRangeHasNoTimeCondition(t *testing.T) {
	f := DashboardFilters{TimeRange: "custom", CustomTimeRange: "now-6h to yesterday"}
	if got := f.SqlClause(); got != "" {
		t.Errorf("SqlClause = %q, want none", got)
	}
}
