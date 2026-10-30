package widget

import (
	"github.com/sandstorm/dashica/lib/dashboard/sql"
)

type Table struct {
	// sql is the underlying query builder; adjust it with AdjustQuery. Columns
	// are taken as-is from the query result, one column per table column.
	sql sql.SqlQueryable
	// title is the table title shown above the widget.
	title string `dashica-gen:"client"`
	// id is the stable widget id (its URL "<page>/api/<id>"); assigned by the page when empty.
	id string
	// height is the table height in pixels.
	height int `dashica-gen:"client"`
	// limit caps the number of rows fetched via a SQL LIMIT clause.
	limit int `dashica-gen:"client"`
}

func NewTable(sql sql.SqlQueryable) *Table {
	return &Table{
		sql:    sql,
		height: 500,
		limit:  10000,
	}
}

func (b *Table) Title(title string) *Table {
	cloned := *b
	cloned.title = title
	return &cloned
}

func (b *Table) Id(id string) *Table {
	cloned := *b
	cloned.id = id
	return &cloned
}

func (b *Table) Height(height int) *Table {
	cloned := *b
	cloned.height = height
	return &cloned
}

func (b *Table) Limit(limit int) *Table {
	cloned := *b
	cloned.limit = limit
	return &cloned
}

func (b *Table) AdjustQuery(opts ...sql.SqlBuilderOption) *Table {
	cloned := *b
	cloned.sql = cloned.sql.With(opts...)
	return &cloned
}

func (b *Table) Query() sql.SqlQueryable {
	return b.sql.With(sql.Limit(b.limit))
}

func (b *Table) explicitId() string { return b.id }
