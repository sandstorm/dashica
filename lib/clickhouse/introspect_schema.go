package clickhouse

import (
	"context"
	"fmt"
	"slices"
	"strings"
)

const tableListQuery = `
SELECT name
FROM system.tables
WHERE database = {db:String}
  AND engine IN ('MergeTree')
  AND (name ILIKE 'full_%' OR name ILIKE 'mv_%' OR name ILIKE 'proapp_%' OR name ILIKE 'temp_%')
  AND name != 'full_metrics'
  AND name NOT LIKE 'dashica_%'
ORDER BY name
`

type TableListRow struct {
	Name string `json:"name"`
}

func (c *Client) IntrospectSchema(ctx context.Context) (*IntrospectedSchema, error) {
	c.introspectedSchemaMutex.Lock()
	defer c.introspectedSchemaMutex.Unlock()

	if c.introspectedSchemaCached != nil {
		return c.introspectedSchemaCached, nil
	}
	opts := DefaultQueryOptions()
	opts.Parameters["db"] = c.serverConfig.Database

	// Find all database tables
	result, err := QueryJSON[TableListRow](ctx, c, tableListQuery, opts)
	if err != nil {
		return nil, fmt.Errorf("query tables: %w", err)
	}

	tables := make([]string, 0, len(result.Data))
	for _, row := range result.Data {
		tables = append(tables, row.Name)
	}

	if len(tables) == 0 {
		return &IntrospectedSchema{CommonColumns: []string{}}, nil
	}

	// Create a quoted list of table names for the SQL query
	quotedTables := make([]string, 0, len(tables))
	for _, table := range tables {
		quotedTables = append(quotedTables, fmt.Sprintf("'%s'", table))
	}

	// Query to get columns for the tables. Ordered by table + position so the
	// per-table column lists come back in schema-definition order.
	columnQuery := fmt.Sprintf(`
		SELECT table, name, comment, type
		FROM system.columns
		WHERE database = {db:String}
		AND table IN (%s)
		ORDER BY table, position
	`, strings.Join(quotedTables, ", "))

	type ColumnRow struct {
		Table   string `json:"table"`
		Name    string `json:"name"`
		Comment string `json:"comment"`
		Type    string `json:"type"`
	}

	columnResult, err := QueryJSON[ColumnRow](ctx, c, columnQuery, opts)
	if err != nil {
		return nil, fmt.Errorf("query columns: %w", err)
	}

	// Map for tracking which tables contain which columns
	tablesPerColumn := make(map[string][]string)
	columnsPerTable := make(map[string][]string)
	// Full column detail (name/type/comment) per table, for the field pickers.
	columnDetail := make(map[string][]Column, len(tables))

	// Populate the maps
	for _, row := range columnResult.Data {
		table := row.Table
		column := row.Name

		// Add column to columnsPerTable
		if _, exists := columnsPerTable[table]; !exists {
			columnsPerTable[table] = []string{}
		}
		columnsPerTable[table] = append(columnsPerTable[table], column)

		columnDetail[table] = append(columnDetail[table], Column{
			Name:    row.Name,
			Type:    row.Type,
			Comment: row.Comment,
			Class:   ClassifyColumnType(row.Type),
		})

		// Add table to tablesPerColumn
		if _, exists := tablesPerColumn[column]; !exists {
			tablesPerColumn[column] = []string{}
		}
		tablesPerColumn[column] = append(tablesPerColumn[column], table)
	}

	// Find common columns (those that appear in all tables)
	commonColumns := []string{}
	for column, tableList := range tablesPerColumn {
		if len(tableList) == len(tables) && columnsPerTable[column] == nil {
			commonColumns = append(commonColumns, column)
		}
	}

	slices.Sort(commonColumns)

	schema := &IntrospectedSchema{Tables: tables, CommonColumns: commonColumns, Columns: columnDetail}
	c.introspectedSchemaCached = schema
	return schema, nil
}

// Column describes one table column: its name, ClickHouse type, comment, and
// its semantic class (see ClassifyColumnType).
type Column struct {
	Name    string `json:"name"`
	Type    string `json:"type"`
	Comment string `json:"comment,omitempty"`
	// Class is the semantic column class the Explore editor speaks in:
	// "temporal", "categorical", "continuous", or "" when unknown. This is the
	// single home for the ClickHouse-type → class mapping; the editor derives
	// slot-aware pickers, badges, and value affordances from it (docs UX plan (3)).
	Class string `json:"class,omitempty"`
}

// Column class constants — the vocabulary the Explore editor speaks (docs UX
// plan (3)): temporal (time axes), categorical/ordinal (fills, facets, WHERE
// values), continuous/numeric (aggregations). Kept as plain strings on the wire.
const (
	ColumnClassTemporal    = "temporal"
	ColumnClassCategorical = "categorical"
	ColumnClassContinuous  = "continuous"
)

// ClassifyColumnType maps a ClickHouse column type to its semantic class. It is
// the one place the mapping lives, so the editor's language and Observable
// Plot's scale semantics (time / ordinal / linear) agree. Wrappers
// (Nullable/LowCardinality) are unwrapped first; an unrecognised type yields ""
// (neutral — the editor neither prefers nor demotes it).
func ClassifyColumnType(chType string) string {
	t := unwrapColumnType(chType)

	switch {
	case strings.HasPrefix(t, "Date"): // Date, Date32, DateTime, DateTime64
		return ColumnClassTemporal
	case strings.HasPrefix(t, "Int"), strings.HasPrefix(t, "UInt"),
		strings.HasPrefix(t, "Float"), strings.HasPrefix(t, "Decimal"):
		return ColumnClassContinuous
	case strings.HasPrefix(t, "String"), strings.HasPrefix(t, "FixedString"),
		strings.HasPrefix(t, "Enum"), strings.HasPrefix(t, "UUID"),
		strings.HasPrefix(t, "IPv"), t == "Bool", t == "Boolean":
		return ColumnClassCategorical
	default:
		return ""
	}
}

// unwrapColumnType peels the type modifiers that do not change the semantic
// class — Nullable(T) and LowCardinality(T) — down to the inner type.
func unwrapColumnType(t string) string {
	t = strings.TrimSpace(t)
	for {
		inner, ok := strings.CutPrefix(t, "Nullable(")
		if !ok {
			inner, ok = strings.CutPrefix(t, "LowCardinality(")
		}
		if !ok {
			return t
		}
		t = strings.TrimSpace(strings.TrimSuffix(inner, ")"))
	}
}

type IntrospectedSchema struct {
	CommonColumns []string `json:"commonColumns"`
	Tables        []string `json:"tables"`
	// Columns maps each table to its columns (with types), in schema order.
	Columns map[string][]Column `json:"columns"`
}
