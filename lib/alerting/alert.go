package alerting

import "github.com/sandstorm/dashica/lib/dashboard/sql"

// Alert is a Go-code-configured alert definition, built with a fluent API.
// Use NewAlert to create one, then chain methods to configure it.
// Call ToDefinition to convert it to an AlertDefinition for the scheduler.
type Alert struct {
	key string
	// query is the time-series SQL query (used for both visualization and evaluation base).
	// Must return columns: time (DateTime64), time_ts (UInt64), value (Float64).
	query sql.SqlQueryable
	// evaluationFilter is an extra WHERE clause added only during cron evaluation.
	// It limits the query to the current time bucket so the evaluator gets exactly 1 row.
	// Example: "toStartOfHour(timestamp) = toStartOfHour(now())"
	evaluationFilter string
	alertIf          AlertCondition
	message          string
	checkEvery       string
	slackChannel     string
}

func NewAlert(key string) *Alert {
	return &Alert{key: key}
}

func (a *Alert) Query(q sql.SqlQueryable) *Alert {
	cloned := *a
	cloned.query = q
	return &cloned
}

// EvaluationFilter sets a WHERE clause appended only during scheduled evaluation.
// It should narrow the query to the current time bucket so exactly one row is returned.
func (a *Alert) EvaluationFilter(clause string) *Alert {
	cloned := *a
	cloned.evaluationFilter = clause
	return &cloned
}

func (a *Alert) AlertWhenAbove(threshold float64) *Alert {
	cloned := *a
	cloned.alertIf = AlertCondition{ValueGt: &threshold}
	return &cloned
}

func (a *Alert) AlertWhenBelow(threshold float64) *Alert {
	cloned := *a
	cloned.alertIf = AlertCondition{ValueLt: &threshold}
	return &cloned
}

func (a *Alert) Message(msg string) *Alert {
	cloned := *a
	cloned.message = msg
	return &cloned
}

func (a *Alert) CheckEvery(expr string) *Alert {
	cloned := *a
	cloned.checkEvery = expr
	return &cloned
}

func (a *Alert) SlackChannel(channel string) *Alert {
	cloned := *a
	cloned.slackChannel = channel
	return &cloned
}

func (a *Alert) Key() string {
	return a.key
}

func (a *Alert) GetQuery() sql.SqlQueryable {
	return a.query
}

func (a *Alert) GetAlertIf() AlertCondition {
	return a.alertIf
}

// ToDefinition converts the Alert to an AlertDefinition for use by the scheduler.
// group is the logical group identifier (e.g. "src/p_oekokiste").
func (a *Alert) ToDefinition(group string) AlertDefinition {
	return AlertDefinition{
		Id:               AlertId{Group: group, Key: a.key},
		QueryBuilder:     a.query,
		EvaluationFilter: a.evaluationFilter,
		AlertIf:          a.alertIf,
		Message:          a.message,
		CheckEvery:       a.checkEvery,
		SlackChannel:     a.slackChannel,
	}
}
