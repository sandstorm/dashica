package httpserver

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
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

func TestResolveTimeRange(t *testing.T) {
	now := time.Date(2026, 10, 29, 12, 0, 0, 0, time.Local)
	tests := map[string]struct {
		filters  DashboardFilters
		from, to time.Time
	}{
		"preset":   {filters: DashboardFilters{TimeRange: "90m"}, from: now.Add(-90 * time.Minute), to: now},
		"relative": {filters: DashboardFilters{TimeRange: "custom", CustomTimeRange: "now-6h to now-1h"}, from: now.Add(-6 * time.Hour), to: now.Add(-time.Hour)},
		"absolute": {
			filters: DashboardFilters{TimeRange: "custom", CustomTimeRange: "2026-10-28 08:00 to 2026-10-28 09:30"},
			from:    time.Date(2026, 10, 28, 8, 0, 0, 0, time.Local),
			to:      time.Date(2026, 10, 28, 9, 30, 0, 0, time.Local),
		},
	}
	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			from, to, err := tt.filters.ResolveTimeRange(now)
			if err != nil {
				t.Fatalf("ResolveTimeRange: %v", err)
			}
			if !from.Equal(tt.from) || !to.Equal(tt.to) {
				t.Errorf("ResolveTimeRange = %v to %v, want %v to %v", from, to, tt.from, tt.to)
			}
		})
	}
}

func TestResolveTimeRange_SaysWhatIsWrong(t *testing.T) {
	tests := map[string]struct {
		filters DashboardFilters
		want    string
	}{
		"unreadable end": {filters: DashboardFilters{TimeRange: "custom", CustomTimeRange: "yesterday to now"}, want: `"yesterday"`},
		"one end":        {filters: DashboardFilters{TimeRange: "custom", CustomTimeRange: "now-1h"}, want: `<from> to <to>`},
		"from after to":  {filters: DashboardFilters{TimeRange: "custom", CustomTimeRange: "now-1h to now-2h"}, want: "before"},
		"no duration":    {filters: DashboardFilters{TimeRange: "2d"}, want: `"2d"`},
	}
	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			_, _, err := tt.filters.ResolveTimeRange(time.Now())
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Errorf("ResolveTimeRange: err = %v, want one saying %s", err, tt.want)
			}
		})
	}
}

func TestTimeRangeHandler(t *testing.T) {
	filters := url.Values{"filters": {`{"timeRange":"custom","customTimeRange":"2026-10-28 08:00 to 2026-10-28 09:30"}`}}
	rec := httptest.NewRecorder()
	TimeRangeHandler(rec, httptest.NewRequest(http.MethodGet, "/time-range?"+filters.Encode(), nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
	from := time.Date(2026, 10, 28, 8, 0, 0, 0, time.Local).UnixMilli()
	to := time.Date(2026, 10, 28, 9, 30, 0, 0, time.Local).UnixMilli()
	if want := fmt.Sprintf(`{"from":%d,"to":%d}`, from, to); strings.TrimSpace(rec.Body.String()) != want {
		t.Errorf("body = %s, want %s", rec.Body, want)
	}
}

func TestTimeRangeHandler_SaysWhatIsWrong(t *testing.T) {
	filters := url.Values{"filters": {`{"timeRange":"custom","customTimeRange":"yesterday to now"}`}}
	rec := httptest.NewRecorder()
	TimeRangeHandler(rec, httptest.NewRequest(http.MethodGet, "/time-range?"+filters.Encode(), nil))
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), `"yesterday"`) {
		t.Errorf("got %d %q, want 400 naming \"yesterday\"", rec.Code, rec.Body)
	}
}

func TestResolveTimeRangeFromDbAsTime_SaysWhatIsWrong(t *testing.T) {
	f := DashboardFilters{TimeRange: "custom", CustomTimeRange: "yesterday to now"}
	_, err := f.ResolveTimeRangeFromDbAsTime(t.Context(), nil)
	if err == nil || !strings.Contains(err.Error(), `"yesterday"`) {
		t.Errorf("err = %v, want one naming \"yesterday\"", err)
	}
}
