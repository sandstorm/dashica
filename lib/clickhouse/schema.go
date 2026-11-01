package clickhouse

import (
	"context"
	"fmt"
	"strings"
)

// Schema is what a connection holds, as the Schema view shows it: its databases with their tables, each with its
// columns, keys, TTL and skip indices, as ClickHouse's system tables say.
type Schema struct {
	// Database is the connection's own database (dashica_config's `database`): the one a table named without database
	// is in, as page.json's `table` names it (filter.FilterService.TableName).
	Database string `json:"database"`
	// Databases by name, each with its tables by name.
	Databases []SchemaDatabase `json:"databases"`
}

// Columns are the columns of the table `table` in the database `database` ("default", "http_logs"), in their order;
// false for a table the schema does not have.
func (s Schema) Columns(database, table string) ([]SchemaColumn, bool) {
	for _, db := range s.Databases {
		if db.Name != database {
			continue
		}
		for _, t := range db.Tables {
			if t.Name == table {
				return t.Columns, true
			}
		}
	}
	return nil, false
}

// Schema is the connection's Schema, asked from its system tables the first time and then kept; `refresh` asks them
// again and keeps the new answer. A failed query keeps what was kept before.
func (c *Client) Schema(ctx context.Context, refresh bool) (Schema, error) {
	c.schemaMutex.Lock()
	defer c.schemaMutex.Unlock()
	if c.schemaCached != nil && !refresh {
		return *c.schemaCached, nil
	}
	opts := DefaultQueryOptions()
	tables, err := QueryJSON[schemaTableRow](ctx, c, schemaTablesQuery, opts)
	if err != nil {
		return Schema{}, fmt.Errorf("query system.tables: %w", err)
	}
	columns, err := QueryJSON[schemaColumnRow](ctx, c, schemaColumnsQuery, opts)
	if err != nil {
		return Schema{}, fmt.Errorf("query system.columns: %w", err)
	}
	indices, err := QueryJSON[schemaSkipIndexRow](ctx, c, schemaSkipIndicesQuery, opts)
	if err != nil {
		return Schema{}, fmt.Errorf("query system.data_skipping_indices: %w", err)
	}
	schema := assembleSchema(c.serverConfig.Database, tables.Data, columns.Data, indices.Data)
	c.schemaCached = &schema
	return schema, nil
}

// SchemaDatabase is a database of a connection ("default", "system") with its tables.
type SchemaDatabase struct {
	Name   string        `json:"name"`
	Tables []SchemaTable `json:"tables"`
}

// SchemaTable is a table (or view) as DataGrip shows one: its columns in their order, its engine, its keys, its TTL
// and its skip indices; a key ClickHouse does not have for it is empty.
type SchemaTable struct {
	Name string `json:"name"`
	// Engine is its engine's name ("MergeTree", "View").
	Engine string `json:"engine"`
	// SortingKey is its ORDER BY ("customer_tenant, timestamp").
	SortingKey   string `json:"sortingKey"`
	PartitionKey string `json:"partitionKey"`
	PrimaryKey   string `json:"primaryKey"`
	// Ttl is its table TTL ("timestamp + toIntervalDay(30)"), as its engine_full says it (tableTtl).
	Ttl         string            `json:"ttl"`
	Comment     string            `json:"comment"`
	Columns     []SchemaColumn    `json:"columns"`
	SkipIndices []SchemaSkipIndex `json:"skipIndices"`
}

// SchemaColumn is a column of a table: its name, its type, its default and its comment.
type SchemaColumn struct {
	Name string `json:"name"`
	Type string `json:"type"`
	// DefaultKind is "DEFAULT", "MATERIALIZED", "ALIAS" or "EPHEMERAL", empty without a default.
	DefaultKind       string `json:"defaultKind"`
	DefaultExpression string `json:"defaultExpression"`
	Comment           string `json:"comment"`
}

// SchemaSkipIndex is a data skipping index of a table: `INDEX <name> <expression> TYPE <type> GRANULARITY <n>`.
type SchemaSkipIndex struct {
	Name string `json:"name"`
	// Type is its type with its arguments ("bloom_filter(0.01)", "minmax").
	Type        string `json:"type"`
	Expression  string `json:"expression"`
	Granularity int64  `json:"granularity"`
}

// The query set the Schema of a connection is made of: every table, column and skip index its user may see.
const (
	schemaTablesQuery = `SELECT database, name, engine, engine_full, sorting_key, partition_key, primary_key, comment
FROM system.tables WHERE NOT is_temporary ORDER BY database, name`
	schemaColumnsQuery = `SELECT database, table, name, type, default_kind, default_expression, comment
FROM system.columns ORDER BY database, table, position`
	schemaSkipIndicesQuery = `SELECT database, table, name, type_full AS type, expr, granularity
FROM system.data_skipping_indices ORDER BY database, table, name`
)

// schemaTableRow is a row of schemaTablesQuery.
type schemaTableRow struct {
	Database     string `json:"database"`
	Name         string `json:"name"`
	Engine       string `json:"engine"`
	EngineFull   string `json:"engine_full"`
	SortingKey   string `json:"sorting_key"`
	PartitionKey string `json:"partition_key"`
	PrimaryKey   string `json:"primary_key"`
	Comment      string `json:"comment"`
}

// schemaColumnRow is a row of schemaColumnsQuery.
type schemaColumnRow struct {
	Database          string `json:"database"`
	Table             string `json:"table"`
	Name              string `json:"name"`
	Type              string `json:"type"`
	DefaultKind       string `json:"default_kind"`
	DefaultExpression string `json:"default_expression"`
	Comment           string `json:"comment"`
}

// schemaSkipIndexRow is a row of schemaSkipIndicesQuery.
type schemaSkipIndexRow struct {
	Database    string `json:"database"`
	Table       string `json:"table"`
	Name        string `json:"name"`
	Type        string `json:"type"`
	Expr        string `json:"expr"`
	Granularity int64  `json:"granularity"`
}

// assembleSchema is the Schema of the connection whose own database is `database` from the rows of the query set, each
// sorted by database and table as the queries sort them: a database per database of `tables`, its tables in their
// order, each with its columns and skip indices. A column or index of a table not among `tables` (a temporary one) is
// left out.
func assembleSchema(database string, tables []schemaTableRow, columns []schemaColumnRow, indices []schemaSkipIndexRow) Schema {
	type key struct{ database, table string }
	columnsOf := map[key][]SchemaColumn{}
	for _, c := range columns {
		k := key{c.Database, c.Table}
		columnsOf[k] = append(columnsOf[k], SchemaColumn{Name: c.Name, Type: c.Type, DefaultKind: c.DefaultKind, DefaultExpression: c.DefaultExpression, Comment: c.Comment})
	}
	indicesOf := map[key][]SchemaSkipIndex{}
	for _, i := range indices {
		k := key{i.Database, i.Table}
		indicesOf[k] = append(indicesOf[k], SchemaSkipIndex{Name: i.Name, Type: i.Type, Expression: i.Expr, Granularity: i.Granularity})
	}
	schema := Schema{Database: database, Databases: []SchemaDatabase{}}
	for _, t := range tables {
		if n := len(schema.Databases); n == 0 || schema.Databases[n-1].Name != t.Database {
			schema.Databases = append(schema.Databases, SchemaDatabase{Name: t.Database, Tables: []SchemaTable{}})
		}
		k := key{t.Database, t.Name}
		db := &schema.Databases[len(schema.Databases)-1]
		db.Tables = append(db.Tables, SchemaTable{
			Name:         t.Name,
			Engine:       t.Engine,
			SortingKey:   t.SortingKey,
			PartitionKey: t.PartitionKey,
			PrimaryKey:   t.PrimaryKey,
			Ttl:          tableTtl(t.EngineFull),
			Comment:      t.Comment,
			Columns:      orEmpty(columnsOf[k]),
			SkipIndices:  orEmpty(indicesOf[k]),
		})
	}
	return schema
}

// tableTtl is the table TTL in `engineFull`, a table's engine_full in system.tables (`MergeTree ORDER BY timestamp
// TTL timestamp + toIntervalDay(30) SETTINGS index_granularity = 8192`): what stands between TTL and SETTINGS (or
// the end), which ClickHouse writes in that order; "" without a TTL.
func tableTtl(engineFull string) string {
	_, ttl, ok := strings.Cut(engineFull, " TTL ")
	if !ok {
		return ""
	}
	ttl, _, _ = strings.Cut(ttl, " SETTINGS ")
	return strings.TrimSpace(ttl)
}

// orEmpty is `s`, an empty slice for nil (JSON `[]`, not `null`).
func orEmpty[T any](s []T) []T {
	if s == nil {
		return []T{}
	}
	return s
}
