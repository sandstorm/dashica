package clickhouse

import (
	"context"
	"github.com/sandstorm/dashica/server/test-utils/assertions"
	testServer "github.com/sandstorm/dashica/server/test-utils/test-server"
	"os"
	"testing"
	"time"

	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"
)

// TestClickhouseE2E performs end-to-end tests with a real ClickHouse database
func TestClickhouseE2E(t *testing.T) {
	logger := zerolog.New(zerolog.ConsoleWriter{Out: os.Stderr})
	config, _ := testServer.LoadTestingConfig(t)

	clickhouseManager := NewManager(config, logger)

	// Create a test context with timeout
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	t.Run("TestQueryJSON", func(t *testing.T) {
		testQueryJSON(t, ctx, clickhouseManager)
	})

	t.Run("introspectSchema", func(t *testing.T) {
		testIntrospectSchema(t, ctx, clickhouseManager)
	})

	// Check for goroutine leaks
	// TODO: ENABLE ME - does not work right now
	// assertions.AssertNoGoRoutineLeak(t)
}

func testQueryJSON(t *testing.T, ctx context.Context, clickhouseManager *Manager) {
	// Define a struct type for our test data
	type TestResult struct {
		Value int `json:"value"`
	}

	// Create query options
	options := DefaultQueryOptions()

	dbClient, err := clickhouseManager.GetClient("alert_storage")
	if err != nil {
		t.Fatalf("%s", err)
	}

	// Execute the query and parse results directly into our struct
	result, err := QueryJSON[TestResult](ctx, dbClient, "SELECT 42 AS value", options)
	require.NoError(t, err, "QueryJSON should not return an error")

	// Verify the results
	assertions.AssertEquals(t, "Query should return 1 row", 1, result.Rows)
	assertions.AssertEquals(t, "Result should have 1 data item", 1, len(result.Data))
	assertions.AssertEquals(t, "Value should be 42", 42, result.Data[0].Value)

	// Test QueryJSONFirst
	firstResult, err := QueryJSONFirst[TestResult](ctx, dbClient, "SELECT 42 AS value", options)
	require.NoError(t, err, "QueryJSONFirst should not return an error")
	assertions.AssertEquals(t, "First result value should be 42", 42, firstResult.Value)
}

func testIntrospectSchema(t *testing.T, ctx context.Context, clickhouseManager *Manager) {
	dbClient, err := clickhouseManager.GetClient("alert_storage")
	if err != nil {
		t.Fatalf("%s", err)
	}

	schema, err := dbClient.IntrospectSchema(ctx)
	if err != nil {
		t.Fatalf("%s", err)
	}
	assertions.AssertEquals(t, "schema.Tables does not match", IntrospectedSchema{
		CommonColumns: []string{"customer_project", "customer_tenant", "event_dataset", "event_duration_ms", "event_module", "event_original", "host_group", "host_name", "level", "message", "timestamp"},
		Tables:        []string{"full_logs"},
	}, *schema)
}
