package alerting

import (
	"fmt"
	"strings"

	"github.com/sandstorm/dashica/lib/dashboard/sql"
)

// AlertDefinition is the definition of a single alert
type AlertDefinition struct {
	Id           AlertId
	AlertIf      AlertCondition
	Message      string
	CheckEvery   string
	SlackChannel string

	QueryBuilder          sql.SqlQueryable
	EvaluationFilter      string
	BatchBucketExpression string
}

// AlertId identifies an alert definition uniquely.
type AlertId struct {
	// Group is the logical group name (e.g. "src/p_oekokiste").
	Group string
	// Key is the alert key within that group.
	Key string
}

func AlertIdFromString(in string) AlertId {
	parts := strings.SplitN(in, "#", 2)
	return AlertId{
		Group: parts[0],
		Key:   parts[1],
	}
}

func (id AlertId) String() string {
	return fmt.Sprintf("%s#%s", id.Group, id.Key)
}

// AlertCondition defines when a single alert (defined by AlertDefinition) triggers.
type AlertCondition struct {
	ValueGt *float64 `json:"value_gt"`
	ValueLt *float64 `json:"value_lt"`
}
