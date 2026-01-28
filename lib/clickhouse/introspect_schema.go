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

	// Query to get columns for the tables
	columnQuery := fmt.Sprintf(`
		SELECT table, name, comment, type
		FROM system.columns
		WHERE database = {db:String}
		AND table IN (%s)
		ORDER BY name
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

	// Populate the maps
	for _, row := range columnResult.Data {
		table := row.Table
		column := row.Name

		// Add column to columnsPerTable
		if _, exists := columnsPerTable[table]; !exists {
			columnsPerTable[table] = []string{}
		}
		columnsPerTable[table] = append(columnsPerTable[table], column)

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

	schema := &IntrospectedSchema{Tables: tables, CommonColumns: commonColumns}
	c.introspectedSchemaCached = schema
	return schema, nil
}

type IntrospectedSchema struct {
	CommonColumns []string `json:"commonColumns"`
	Tables        []string `json:"tables"`
}
