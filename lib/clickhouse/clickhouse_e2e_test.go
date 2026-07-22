package clickhouse

import (
	"context"
	"fmt"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/sandstorm/dashica/lib/testutil/assertions"
	testServer "github.com/sandstorm/dashica/lib/testutil/testserver"

	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"
)

// TestClickhouseE2E performs end-to-end tests with a real Clickhouse database
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

	t.Run("arrowJSONColumn", func(t *testing.T) {
		testArrowJSONColumn(t, ctx, clickhouseManager)
	})

	t.Run("arrowWrapOrdering", func(t *testing.T) {
		testArrowWrapOrdering(t, ctx, clickhouseManager)
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

// findArrowUnsafeColumn returns the name of a full_logs column whose type
// cannot be serialized to Arrow (JSON/Object/Dynamic/Variant), or "" if none.
func findArrowUnsafeColumn(t *testing.T, ctx context.Context, c *Client) string {
	t.Helper()
	cols, err := c.describeQuery(ctx, "SELECT * FROM full_logs", DefaultQueryOptions())
	require.NoError(t, err, "DESCRIBE full_logs")
	for _, col := range cols {
		if arrowUnsafeType(col.Type) {
			return col.Name
		}
	}
	return ""
}

// testArrowJSONColumn proves the transport-level fix: a SELECT * over a table
// with a JSON column (full_logs.event_original) errors on a raw Arrow query but
// succeeds through QueryToHandler, which wraps it to cast the column to String.
func testArrowJSONColumn(t *testing.T, ctx context.Context, clickhouseManager *Manager) {
	c, err := clickhouseManager.GetClient("alert_storage")
	require.NoError(t, err)

	unsafeCol := findArrowUnsafeColumn(t, ctx, c)
	if unsafeCol == "" {
		t.Skip("full_logs has no Arrow-incompatible column; nothing to exercise")
	}

	query := "SELECT * FROM full_logs LIMIT 5"

	// Raw Arrow query must fail — this is the bug the fix addresses.
	_, err = c.Query(ctx, query, DefaultQueryOptions())
	require.Error(t, err, "raw Arrow SELECT * over a JSON column should error")

	// Through QueryToHandler (with the arrow-compat wrap) it must succeed.
	rec := httptest.NewRecorder()
	err = c.QueryToHandler(ctx, query, DefaultQueryOptions(), rec)
	require.NoError(t, err, "QueryToHandler should wrap the JSON column and succeed")
	require.Equal(t, 200, rec.Code)
	require.NotZero(t, rec.Body.Len(), "expected a non-empty Arrow stream")
}

// testArrowWrapOrdering guards the row-order risk of the outer pass-through
// SELECT: an ORDER BY inside the wrapped subquery must survive the wrap.
func testArrowWrapOrdering(t *testing.T, ctx context.Context, clickhouseManager *Manager) {
	c, err := clickhouseManager.GetClient("alert_storage")
	require.NoError(t, err)

	unsafeCol := findArrowUnsafeColumn(t, ctx, c)
	if unsafeCol == "" {
		t.Skip("full_logs has no Arrow-incompatible column; nothing to exercise")
	}

	// Include the JSON column so ensureArrowCompatible actually wraps the query.
	query := fmt.Sprintf(
		"SELECT timestamp, `%s` FROM full_logs ORDER BY timestamp ASC LIMIT 20", unsafeCol)

	wrapped, err := c.ensureArrowCompatible(ctx, query, DefaultQueryOptions())
	require.NoError(t, err)
	require.NotEqual(t, query, wrapped, "query with a JSON column should have been wrapped")

	type row struct {
		Timestamp string `json:"timestamp"`
	}
	res, err := QueryJSON[row](ctx, c, wrapped, DefaultQueryOptions())
	require.NoError(t, err, "wrapped query should execute")

	prev := ""
	for i, r := range res.Data {
		if i > 0 {
			require.GreaterOrEqual(t, r.Timestamp, prev,
				"wrapped query lost ORDER BY: row %d timestamp %q < %q", i, r.Timestamp, prev)
		}
		prev = r.Timestamp
	}
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
	assertions.AssertEquals(t, "schema.Tables does not match",
		[]string{"full_logs", "mv_caddy_accesslog"}, schema.Tables)
	assertions.AssertEquals(t, "schema.CommonColumns does not match",
		[]string{"customer_project", "customer_tenant", "host_group", "host_name", "timestamp"}, schema.CommonColumns)

	// Columns carries per-table name/type detail (in schema order). Assert the
	// tables are present and spot-check a representative column's type rather
	// than pinning the entire column list (brittle against schema tweaks).
	if _, ok := schema.Columns["full_logs"]; !ok {
		t.Fatalf("expected columns for full_logs, got %v", schema.Columns)
	}
	if _, ok := schema.Columns["mv_caddy_accesslog"]; !ok {
		t.Fatalf("expected columns for mv_caddy_accesslog, got %v", schema.Columns)
	}
	timestampType := ""
	for _, c := range schema.Columns["full_logs"] {
		if c.Name == "timestamp" {
			timestampType = c.Type
		}
	}
	assertions.AssertEquals(t, "full_logs.timestamp type", "DateTime64(6)", timestampType)
}
