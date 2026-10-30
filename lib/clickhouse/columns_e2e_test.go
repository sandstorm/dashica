// Tests for Columns against a real ClickHouse.
package clickhouse

import (
	"context"
	"reflect"
	"testing"

	"github.com/rs/zerolog"
	testServer "github.com/sandstorm/dashica/lib/testutil/testserver"
)

func TestColumns_DescribesTheTableAndKeepsItsScalarColumns(t *testing.T) {
	config, _ := testServer.LoadTestingConfig(t)
	manager := NewManager(config, zerolog.Nop())
	// a table function stands in for a table: DESCRIBE TABLE takes both
	table := "values('status UInt16, path String, attrs Map(String, String)', (500, '/a', {'host': 'shop'}))"

	columns, err := manager.Columns(context.Background(), "", table)
	if err != nil {
		t.Fatalf("Columns: %v", err)
	}
	if want := []string{"status", "path"}; !reflect.DeepEqual(columns, want) {
		t.Errorf("columns %v, want %v", columns, want)
	}
	client, _ := manager.GetClient("default")
	if cached := client.columns.known[table]; !reflect.DeepEqual(cached, columns) {
		t.Errorf("not kept: %v", cached)
	}
}
