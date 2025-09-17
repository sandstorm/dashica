package alerting

import (
	"testing"
	"testing/fstest"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestAlertConfiguration tests the alert configuration parsing functionality
func TestAlertConfiguration(t *testing.T) {
	t.Run("ParseAlertConfiguration", func(t *testing.T) {
		// Create a test filesystem with mock files
		mockFS := fstest.MapFS{
			"alerts/test/alerts.yaml": &fstest.MapFile{
				Data: []byte(`
alerts:
  cpu_usage:
    query_path: "queries/cpu_usage.sql"
    params:
      threshold: "90"
    alert_if:
      value_gt: 90
    message: "CPU usage is above 90%"
    check_every: "5m"
  memory_usage:
    query_path: "queries/memory_usage.sql"
    params:
      threshold: "80"
    alert_if:
      value_lt: 20
    message: "Memory available is below 20%"
    check_every: "10m"`),
			},
			"alerts/test/queries/cpu_usage.sql": &fstest.MapFile{
				Data: []byte(`
--BUCKET: 5m
SELECT 
  avg(usage) as avg_usage 
FROM system.metrics 
WHERE metric = 'cpu' 
  AND time >= now() - interval 5 minute`),
			},
			"alerts/test/queries/memory_usage.sql": &fstest.MapFile{
				Data: []byte(`--BUCKET: 15m
SELECT 
  avg(available_memory) as avg_memory 
FROM system.metrics 
WHERE metric = 'memory' 
  AND time >= now() - interval 15 minute`),
			},
		}

		// Test successful parsing
		t.Run("SuccessfulParsing", func(t *testing.T) {
			alertDefinitions, err := ParseAlertConfiguration(mockFS, "alerts/test/alerts.yaml")
			require.NoError(t, err)
			require.Len(t, alertDefinitions, 2, "Should have 2 alert definitions")

			// Check CPU alert
			cpuAlert := alertDefinitions[0]
			if cpuAlert.Id.Key != "cpu_usage" {
				cpuAlert = alertDefinitions[1]
			}
			assert.Equal(t, "cpu_usage", cpuAlert.Id.Key)
			assert.Equal(t, "alerts/test/alerts.yaml", cpuAlert.Id.Group)
			assert.Equal(t, "alerts/test/queries/cpu_usage.sql", cpuAlert.QueryPath)
			assert.Contains(t, cpuAlert.Query, "avg(usage) as avg_usage")
			assert.Equal(t, "5m", cpuAlert.QueryBucketExpression)
			assert.Equal(t, "90", cpuAlert.Params["threshold"])
			assert.NotNil(t, cpuAlert.AlertIf.ValueGt)
			assert.Equal(t, 90.0, *cpuAlert.AlertIf.ValueGt)
			assert.Nil(t, cpuAlert.AlertIf.ValueLt)
			assert.Equal(t, "CPU usage is above 90%", cpuAlert.Message)
			assert.Equal(t, "5m", cpuAlert.CheckEvery)

			// Check Memory alert
			memAlert := alertDefinitions[1]
			if memAlert.Id.Key != "memory_usage" {
				memAlert = alertDefinitions[0]
			}
			assert.Equal(t, "memory_usage", memAlert.Id.Key)
			assert.Equal(t, "alerts/test/alerts.yaml", memAlert.Id.Group)
			assert.Equal(t, "alerts/test/queries/memory_usage.sql", memAlert.QueryPath)
			assert.Contains(t, memAlert.Query, "avg(available_memory) as avg_memory")
			assert.Equal(t, "15m", memAlert.QueryBucketExpression)
			assert.Equal(t, "80", memAlert.Params["threshold"])
			assert.Nil(t, memAlert.AlertIf.ValueGt)
			assert.NotNil(t, memAlert.AlertIf.ValueLt)
			assert.Equal(t, 20.0, *memAlert.AlertIf.ValueLt)
			assert.Equal(t, "Memory available is below 20%", memAlert.Message)
			assert.Equal(t, "10m", memAlert.CheckEvery)
		})

		// Test missing query path
		t.Run("MissingQueryPath", func(t *testing.T) {
			mockFSWithError := fstest.MapFS{
				"alerts/test/alerts_error.yaml": &fstest.MapFile{
					Data: []byte(`
alerts:
  cpu_usage:
    params:
      threshold: "90"
    alert_if:
      value_gt: 90
    message: "CPU usage is above 90%"
    check_every: "5m"`),
				},
			}

			_, err := ParseAlertConfiguration(mockFSWithError, "alerts/test/alerts_error.yaml")
			require.Error(t, err)
			assert.Contains(t, err.Error(), "no query path defined")
		})

		// Test non-existent query file
		t.Run("NonExistentQueryFile", func(t *testing.T) {
			mockFSWithError := fstest.MapFS{
				"alerts/test/alerts_error.yaml": &fstest.MapFile{
					Data: []byte(`
alerts:
  cpu_usage:
    query_path: "queries/non_existent.sql"
    params:
      threshold: "90"
    alert_if:
      value_gt: 90
    message: "CPU usage is above 90%"
    check_every: "5m"`),
				},
			}

			_, err := ParseAlertConfiguration(mockFSWithError, "alerts/test/alerts_error.yaml")
			require.Error(t, err)
			assert.Contains(t, err.Error(), "reading file")
		})

		// Test missing bucket expression
		t.Run("MissingBucketExpression", func(t *testing.T) {
			mockFSWithError := fstest.MapFS{
				"alerts/test/alerts_error.yaml": &fstest.MapFile{
					Data: []byte(`
alerts:
  cpu_usage:
    query_path: "queries/missing_bucket.sql"
    params:
      threshold: "90"
    alert_if:
      value_gt: 90
    message: "CPU usage is above 90%"
    check_every: "5m"`),
				},
				"alerts/test/queries/missing_bucket.sql": &fstest.MapFile{
					Data: []byte(`
SELECT 
  avg(usage) as avg_usage 
FROM system.metrics 
WHERE metric = 'cpu' 
  AND time >= now() - interval 5 minute`),
				},
			}

			_, err := ParseAlertConfiguration(mockFSWithError, "alerts/test/alerts_error.yaml")
			require.Error(t, err)
			assert.Contains(t, err.Error(), "Bucket Expression --BUCKET: ... not found")
		})

		// Test AlertId functionality
		t.Run("AlertIdFunctions", func(t *testing.T) {
			// Test creation from string
			id := AlertIdFromString("group1#alert1")
			assert.Equal(t, "group1", id.Group)
			assert.Equal(t, "alert1", id.Key)

			// Test string conversion
			assert.Equal(t, "group1#alert1", id.String())
		})
	})

	t.Run("ExtractBucketExpression", func(t *testing.T) {
		// Test successful extraction
		t.Run("SuccessfulExtraction", func(t *testing.T) {
			sql := `--BUCKET: 5m
SELECT * FROM table`
			result, err := extractBucketExpression(sql)
			require.NoError(t, err)
			assert.Equal(t, "5m", result)
		})

		// Test extraction with spaces
		t.Run("ExtractionWithSpaces", func(t *testing.T) {
			sql := `-- Some comment
--BUCKET:   15m   
SELECT * FROM table`
			result, err := extractBucketExpression(sql)
			require.NoError(t, err)
			assert.Equal(t, "15m", result)
		})

		// Test missing bucket expression
		t.Run("MissingBucketExpression", func(t *testing.T) {
			sql := `-- Some comment
SELECT * FROM table`
			_, err := extractBucketExpression(sql)
			require.Error(t, err)
			assert.Contains(t, err.Error(), "Bucket Expression --BUCKET: ... not found")
		})

		// Test bucket expression after first 3 lines
		t.Run("BucketExpressionTooLate", func(t *testing.T) {
			sql := `-- Line 1
-- Line 2
-- Line 3
--BUCKET: 10m
SELECT * FROM table`
			_, err := extractBucketExpression(sql)
			require.Error(t, err)
			assert.Contains(t, err.Error(), "Bucket Expression --BUCKET: ... not found")
		})
	})
}
