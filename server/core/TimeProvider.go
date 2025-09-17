package core

import (
	"time"
)

type TimeProvider interface {
	// NowSqlString returns the SQL now() function for using the database's current time
	NowSqlString() string
	// Now returns the current date/time (e.g. for alert_events timestamps)
	Now() Time
}

// realTimeProvider returns the actual current time as a SQL string
type realTimeProvider struct{}

func NewRealTimeProvider() TimeProvider {
	return &realTimeProvider{}
}

func (p *realTimeProvider) NowSqlString() string {
	return "now()"
}

func (p *realTimeProvider) Now() Time {
	return Time(time.Now())
}

// VirtualTimeProvider allows setting a fixed time for tests
type VirtualTimeProvider struct {
	time time.Time
}

// NewVirtualTimeProvider creates a new VirtualTimeProvider with the specified time
func NewVirtualTimeProvider() *VirtualTimeProvider {
	return &VirtualTimeProvider{time: time.Date(0, 0, 0, 0, 0, 0, 0, time.UTC)}
}

const TIME_FORMAT = "2006-01-02 15:04:05"

// SetTime sets the fake time
func (p *VirtualTimeProvider) SetTime(timeStr string) error {
	parsedTime, err := time.ParseInLocation(TIME_FORMAT, timeStr, time.UTC)
	if err != nil {
		return err
	}
	p.time = parsedTime
	return nil
}

func (p *VirtualTimeProvider) SetTimeObj(time time.Time) {
	p.time = time
}

// NowSqlString returns a SQL timestamp literal string for the fixed time
func (p *VirtualTimeProvider) NowSqlString() string {
	return "toDateTime('" + p.time.Format("2006-01-02 15:04:05.999999") + "')"
}

func (p *VirtualTimeProvider) Now() Time {
	return Time(p.time)
}

func (p *VirtualTimeProvider) IncreaseByOneMinute() {
	p.time = p.time.Add(time.Minute)
}

func (p *VirtualTimeProvider) DecreaseByOneMinute() {
	p.time = p.time.Add(-time.Minute)
}

const CLICKHOUSE_TIME_FORMAT = "2006-01-02 15:04:05"

type Time time.Time

func (m Time) MarshalText() ([]byte, error) {
	text := time.Time(m).Format(CLICKHOUSE_TIME_FORMAT)
	return []byte(text), nil
}
func (m *Time) UnmarshalText(text []byte) error {
	t, err := time.Parse(CLICKHOUSE_TIME_FORMAT, string(text))
	if err == nil {
		*m = Time(t)
	}
	return err
}

func (m Time) ToDbStr() string {
	return time.Time(m).Format(CLICKHOUSE_TIME_FORMAT)
}

func (m Time) SameDayAs(other Time) bool {
	y1, m1, d1 := time.Time(m).Date()
	y2, m2, d2 := time.Time(other).Date()
	return y1 == y2 && m1 == m2 && d1 == d2
}
