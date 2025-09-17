package alerting

import (
	"bufio"
	"fmt"
	"io/fs"
	"path"
	"strings"

	"github.com/goccy/go-yaml"
	"github.com/sandstorm/dashica/server/util"
)

// AlertConfiguration corresponds to a full alerts.yaml file.
type AlertConfiguration struct {
	Alerts map[string]*AlertDefinition `json:"alerts"`
}

// AlertDefinition is the definition of a single alert
type AlertDefinition struct {
	Id        AlertId
	QueryPath string `json:"query_path"`
	// Query contains the SQL file contents after ParseAlertConfiguration
	Query string
	// QueryBucketExpression contains the part after "--BUCKET:" in the SQL file (needed for batch alert evaluation)
	QueryBucketExpression string
	Params                map[string]string `json:"params"`
	AlertIf               AlertCondition    `json:"alert_if"`
	Message               string            `json:"message"`
	// The gronx CRON expression in which the query should be re-executed
	CheckEvery string `json:"check_every"`
	// Slack channel to alert to
	SlackChannel string `json:"slack_channel"`
}

// AlertId identifies an alert definition uniquely.
type AlertId struct {
	// Group is the folder name leading to alerts.yml.
	Group string
	// Key is the key in the AlertConfiguration config
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
	// ValueGt
	// - if 0 result rows returned, this counts as "0". Value is compared.
	// - if 1 result row returned, value is compared.
	// - if >1 result rows returned, error.
	ValueGt *float64 `json:"value_gt"` // TODO: how to handle warning level??
	// TODO: LATERValueGtDynamic    *bool `json:"value_gt"`
	ValueLt *float64 `json:"value_lt"`
	//ResultsetNotEmpty *bool    `json:"resultset_not_empty"`
	//ResultsetEmpty    *bool    `json:"resultset_empty"`
}

func ParseAlertConfiguration(fileSystem fs.FS, filePath string) ([]AlertDefinition, error) {
	contents, err := fs.ReadFile(fileSystem, filePath)
	if err != nil {
		return nil, fmt.Errorf("reading file %s: %w", filePath, err)
	}
	var config AlertConfiguration
	if err := yaml.Unmarshal(contents, &config); err != nil {
		return nil, err
	}

	for k, definition := range config.Alerts {
		definition.Id.Group = filePath
		definition.Id.Key = k

		if definition.QueryPath == "" {
			return nil, fmt.Errorf("%s - no query path defined", k)
		}
		// replace SQL path with full contents
		alertSqlFilePath := path.Clean(path.Join(path.Dir(filePath), definition.QueryPath))
		alertContents, err := fs.ReadFile(fileSystem, alertSqlFilePath)
		if err != nil {
			return nil, fmt.Errorf("%s - reading file %s: %w", k, alertSqlFilePath, err)
		}
		bucketInterval, err := extractBucketExpression(string(alertContents))
		if err != nil {
			return nil, fmt.Errorf("%s - extracting bucket interval from %s: %w", k, alertSqlFilePath, err)
		}

		// Store the query path back in the definition, to ensure it is always normalized.
		definition.QueryPath = alertSqlFilePath
		definition.Query = string(alertContents)
		definition.QueryBucketExpression = bucketInterval
	}

	return util.ValuesToArray(config.Alerts), nil
}
func extractBucketExpression(input string) (string, error) {
	scanner := bufio.NewScanner(strings.NewReader(input))

	lineCount := 0
	prefix := "--BUCKET:"

	for scanner.Scan() && lineCount < 3 {
		line := scanner.Text()
		lineCount++

		if idx := strings.Index(line, prefix); idx >= 0 {
			// Extract everything after the prefix
			return strings.TrimSpace(line[idx+len(prefix):]), nil
		}
	}

	return "", fmt.Errorf("Bucket Expression --BUCKET: ... not found in first 3 lines")
}
