package widget

import (
	"strings"
	"testing"

	"github.com/sandstorm/dashica/lib/dashboard/sql"
)

func TestTableDefaultLimit(t *testing.T) {
	query := sql.New(sql.From("test_table"))
	table := NewTable(query)

	if table.limit != 10000 {
		t.Errorf("Expected default limit of 10000, got %d", table.limit)
	}
}

func TestTableLimitMethod(t *testing.T) {
	query := sql.New(sql.From("test_table"))
	table := NewTable(query).Limit(5000)

	if table.limit != 5000 {
		t.Errorf("Expected limit of 5000, got %d", table.limit)
	}
}

func TestTableLimitCanBeDisabled(t *testing.T) {
	query := sql.New(sql.From("test_table"))
	table := NewTable(query).Limit(0)

	if table.limit != 0 {
		t.Errorf("Expected limit of 0 (disabled), got %d", table.limit)
	}
}

func TestTableLimitChaining(t *testing.T) {
	query := sql.New(sql.From("test_table"))
	table := NewTable(query).
		Title("Test Table").
		Height(400).
		Limit(2500).
		Id("test-id")

	if table.limit != 2500 {
		t.Errorf("Expected limit of 2500 after chaining, got %d", table.limit)
	}
	if table.title != "Test Table" {
		t.Errorf("Expected title 'Test Table', got %q", table.title)
	}
	if table.height != 400 {
		t.Errorf("Expected height 400, got %d", table.height)
	}
	if table.id != "test-id" {
		t.Errorf("Expected id 'test-id', got %q", table.id)
	}
}

func TestTableLimitImmutability(t *testing.T) {
	query := sql.New(sql.From("test_table"))
	table1 := NewTable(query)
	table2 := table1.Limit(100)

	if table1.limit != 10000 {
		t.Errorf("Expected original table to keep default limit of 10000, got %d", table1.limit)
	}
	if table2.limit != 100 {
		t.Errorf("Expected new table to have limit of 100, got %d", table2.limit)
	}
}

func TestTableAppliesLimitToQuery(t *testing.T) {
	query := sql.New(sql.From("test_table"))
	table := NewTable(query).Limit(500)

	// We can't directly test CollectHandlers without a full context,
	// but we can verify the limit is stored correctly and would be applied
	if table.limit != 500 {
		t.Errorf("Expected limit of 500, got %d", table.limit)
	}

	// Build a query manually to verify the limit would be applied
	testQuery := table.sql.With(sql.Limit(table.limit))
	sqlStr := testQuery.Build()

	if !strings.Contains(sqlStr, "LIMIT 500") {
		t.Errorf("Expected query to contain 'LIMIT 500', got:\n%s", sqlStr)
	}
}
