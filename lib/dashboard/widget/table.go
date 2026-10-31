package widget

import (
	"slices"

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

// dimensions are its own fields, those holding categories the ones it makes pills of (/pill): its GROUP BY fields as it selects
// them (by alias, else by definition: `GroupBy(sql.Field("host"))` is the select `JSONExtractString(attrs, 'host') AS
// host`), or all its select fields when it has no GROUP BY (raw rows); for a builder query only, since a SQL file's
// output columns are only in its text.
func (b *Table) dimensions() []sql.SqlField {
	query, ok := b.sql.(*sql.SqlQuery)
	if !ok {
		return nil
	}
	selects := query.SelectFields()
	groupBy := query.GroupByFields()
	if len(groupBy) == 0 {
		return selects
	}
	out := make([]sql.SqlField, 0, len(groupBy))
	for _, group := range groupBy {
		i := slices.IndexFunc(selects, func(s sql.SqlField) bool { return s.Alias() == group.Alias() })
		if i < 0 {
			i = slices.IndexFunc(selects, func(s sql.SqlField) bool { return s.Definition() == group.Definition() })
		}
		if i < 0 {
			out = append(out, group)
		} else {
			out = append(out, selects[i])
		}
	}
	return out
}
