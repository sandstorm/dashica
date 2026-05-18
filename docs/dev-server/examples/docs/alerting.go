package docs

import (
	"github.com/sandstorm/dashica/lib/components/layout"
	"github.com/sandstorm/dashica/lib/dashboard"
	"github.com/sandstorm/dashica/lib/dashboard/widget"
)

func Alerting() dashboard.Dashboard {
	return dashboard.New().
		WithLayout(layout.DocsPage).
		Widget(
			widget.NewMarkdown().
				Title("Alerting").
				Content(`
# Alerting

Alerts are defined in Go code — no YAML or SQL files needed. Each alert is a fluent ` + "`*alerting.Alert`" + ` value that carries its own SQL query and threshold condition.

## Example

` + "```go" + `
// src/p_myproject/alerts.go
package p_myproject

import (
    "github.com/sandstorm/dashica/lib/alerting"
    "github.com/sandstorm/dashica/lib/dashboard/sql"
)

var MyProjectAlerts = []*alerting.Alert{
    alerting.NewAlert("http500ErrorsOverLimit").
        Query(sql.New(
            sql.From("mv_caddy_accesslog"),
            sql.Select(sql.Field("toStartOfHour(timestamp)::DateTime64").WithAlias("time")),
            sql.Select(sql.Field("toUnixTimestamp(time)").WithAlias("time_ts")),
            sql.Select(sql.Count().WithAlias("value")),
            sql.Where("customer_tenant = 'myproject'"),
            sql.Where("status >= 500"),
            sql.GroupBy(sql.Field("time")),
            sql.OrderBy(sql.Field("time ASC")),
        )).
        EvaluationFilter("toStartOfHour(timestamp) = toStartOfHour(now())").
        AlertWhenAbove(500).
        Message("Too many 5xx errors").
        SlackChannel("my-project-alerts").
        CheckEvery("@5minutes"),
}
` + "```" + `

## Required query columns

| Column    | Type       | Description                                   |
|-----------|------------|-----------------------------------------------|
| ` + "`time`" + `    | DateTime64 | Bucket start time                             |
| ` + "`time_ts`" + ` | UInt64     | ` + "`toUnixTimestamp(time)`" + ` — used by batch evaluator |
| ` + "`value`" + `   | Float64    | Metric value compared against the threshold   |

## EvaluationFilter

` + "`EvaluationFilter`" + ` is a plain SQL ` + "`WHERE`" + ` clause appended **only during scheduled evaluation**. It narrows the query to exactly one row (the current time bucket) so the evaluator gets a single ` + "`value`" + ` to compare.

` + "```go" + `
EvaluationFilter("toStartOfHour(timestamp) = toStartOfHour(now())")
` + "```" + `

For non-monotonic metrics (e.g. averages), use the *previous* complete bucket to avoid false positives on partial data:

` + "```go" + `
EvaluationFilter("toStartOfHour(timestamp) = toStartOfHour(now() - INTERVAL 1 HOUR)")
` + "```" + `

The filter is **not** applied when the query is rendered as a chart — the full result set is shown there.

## Threshold conditions

| Method                | Triggers when |
|-----------------------|---------------|
| ` + "`AlertWhenAbove(n)`" + ` | ` + "`value > n`" + `      |
| ` + "`AlertWhenBelow(n)`" + ` | ` + "`value < n`" + `      |

## Check interval

Accepts standard cron expressions or ` + "`gronx`" + ` shortcuts:

` + "```go" + `
CheckEvery("@5minutes")
CheckEvery("@15minutes")
CheckEvery("@hourly")
CheckEvery("0 6 * * *")  // 06:00 UTC daily
` + "```" + `

## Wiring up

In your ` + "`register_*.go`" + ` entrypoint:

` + "```go" + `
d.
    RegisterAlerts("src/p_myproject", p_myproject.MyProjectAlerts...).
    RegisterDashboard("/p_myproject/alerts", p_myproject.AlertsDashboard().WithTitle("Alerts"))
` + "```" + `

` + "`RegisterAlerts`" + ` must be called before ` + "`ListenAndServe`" + `.

## Alerts dashboard

` + "```go" + `
func AlertsDashboard() dashboard.Dashboard {
    d := dashboard.New().
        WithLayout(layout.DefaultPage).
        Widget(widget.NewAlertOverview("%myproject%"))
    for _, alert := range MyProjectAlerts {
        d = d.Widget(
            widget.NewAlertDetailFromAlert(alert).Title("myproject / " + alert.Key()),
        )
    }
    return d
}
` + "```" + `

` + "`NewAlertOverview`" + ` accepts a SQL ` + "`LIKE`" + ` pattern matched against the alert group path.

## Development workflow

1. Define alerts in ` + "`src/p_<project>/alerts.go`" + `
2. Run ` + "`mise r watch`" + ` — alerts are evaluated once on startup
3. Open the alerts dashboard to see current states
4. Use the **"Calculate alerts for current time range"** button to back-fill via ` + "`BatchEvaluator`" + `
5. Adjust thresholds / queries and restart

## Next Steps

- [Deployment](/docs/deployment) - Deploy your dashboard with alerts
- [Queries](/docs/queries) - Learn more about SQL query building
`),
		)
}
