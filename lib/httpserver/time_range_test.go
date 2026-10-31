package httpserver

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
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

func TestSqlClause(t *testing.T) {
	from := time.Date(2026, 10, 29, 10, 0, 0, 0, time.Local)
	to := time.Date(2026, 10, 29, 12, 0, 0, 0, time.Local)
	window := fmt.Sprintf("timestamp >= %d AND timestamp <= %d", from.Unix(), to.Unix())
	tests := map[string]struct {
		query string
		want  string
	}{
		"window only":     {query: "time=1h", want: window},
		"with SQL filter": {query: "time=1h&sql=status+%3E%3D+500", want: window + " AND (status >= 500)"},
		"two SQL chips, each in parentheses": {
			query: "time=1h&sql=duration+%3E+2000&sql=a+OR+b",
			want:  window + " AND (duration > 2000) AND (a OR b)",
		},
	}
	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			if got := parseQueryState(t, tt.query).SqlClause(newTimeRange(from, to)); got != tt.want {
				t.Errorf("SqlClause = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestTimeClause_LeavesOutTheSqlFilter(t *testing.T) {
	from := time.Date(2026, 10, 29, 10, 0, 0, 0, time.Local)
	to := time.Date(2026, 10, 29, 12, 0, 0, 0, time.Local)
	if got, want := TimeClause(newTimeRange(from, to)), fmt.Sprintf("timestamp >= %d AND timestamp <= %d", from.Unix(), to.Unix()); got != want {
		t.Errorf("TimeClause = %q, want %q", got, want)
	}
}

func TestResolveTimeRange(t *testing.T) {
	now := time.Date(2026, 10, 29, 12, 0, 0, 0, time.Local)
	tests := map[string]struct {
		query    url.Values
		from, to time.Time
	}{
		"preset":   {query: url.Values{"time": {"90m"}}, from: now.Add(-90 * time.Minute), to: now},
		"relative": {query: url.Values{"time": {"custom"}, "range": {"now-6h to now-1h"}}, from: now.Add(-6 * time.Hour), to: now.Add(-time.Hour)},
		"absolute": {
			query: url.Values{"time": {"custom"}, "range": {"2026-10-28 08:00 to 2026-10-28 09:30"}},
			from:  time.Date(2026, 10, 28, 8, 0, 0, 0, time.Local),
			to:    time.Date(2026, 10, 28, 9, 30, 0, 0, time.Local),
		},
	}
	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			got, err := parseQueryState(t, tt.query.Encode()).ResolveTimeRange(now)
			if err != nil {
				t.Fatalf("ResolveTimeRange: %v", err)
			}
			if *got.From != tt.from.UnixMilli() || *got.To != tt.to.UnixMilli() {
				t.Errorf("ResolveTimeRange = %d to %d, want %v to %v", *got.From, *got.To, tt.from, tt.to)
			}
		})
	}
}

func TestResolveTimeRange_SaysWhatIsWrong(t *testing.T) {
	tests := map[string]struct {
		customRange string
		want        string
	}{
		"unreadable end": {customRange: "yesterday to now", want: `"yesterday"`},
		"one end":        {customRange: "now-1h", want: `<from> to <to>`},
		"no range":       {customRange: "", want: `<from> to <to>`},
		"from after to":  {customRange: "now-1h to now-2h", want: "before"},
	}
	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			query := url.Values{"time": {"custom"}, "range": {tt.customRange}}
			_, err := parseQueryState(t, query.Encode()).ResolveTimeRange(time.Now())
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Errorf("ResolveTimeRange: err = %v, want one saying %s", err, tt.want)
			}
		})
	}
}

func TestTimeRangeHandler(t *testing.T) {
	query := url.Values{"time": {"custom"}, "range": {"2026-10-28 08:00 to 2026-10-28 09:30"}}
	rec := httptest.NewRecorder()
	TimeRangeHandler(rec, httptest.NewRequest(http.MethodGet, "/time-range?"+query.Encode(), nil))
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
	tests := map[string]struct {
		query url.Values
		want  string
	}{
		"unreadable range": {query: url.Values{"time": {"custom"}, "range": {"yesterday to now"}}, want: `"yesterday"`},
		"no duration":      {query: url.Values{"time": {"2d"}}, want: `"2d"`},
	}
	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			TimeRangeHandler(rec, httptest.NewRequest(http.MethodGet, "/time-range?"+tt.query.Encode(), nil))
			if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), tt.want) {
				t.Errorf("got %d %q, want 400 naming %s", rec.Code, rec.Body, tt.want)
			}
		})
	}
}
