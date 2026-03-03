package sql

import (
	"fmt"
	"strings"
)

// TODO REMOVE ME
type SqlBuildCtx interface {
}

type SqlQuery struct {
	selectF           []SqlField
	from              string
	where             []string
	groupBy           []SqlField
	orderBy           []SqlField
	limit             int
	shouldSkipFilters bool
}

type SqlBuilderOption func(*SqlQuery)

func Select(field SqlField) SqlBuilderOption {
	return func(b *SqlQuery) {
		b.selectF = append(b.selectF, field)
	}
}
func PrependSelect(field SqlField) SqlBuilderOption {
	return func(b *SqlQuery) {
		b.selectF = append([]SqlField{field}, b.selectF...)
	}
}

func SkipFilters() SqlBuilderOption {
	return func(b *SqlQuery) {
		b.shouldSkipFilters = true
	}
}

func From(table string) SqlBuilderOption {
	return func(b *SqlQuery) {
		b.from = table
	}
}
func Where(clause string) SqlBuilderOption {
	return func(b *SqlQuery) {
		b.where = append(b.where, clause)
	}
}
func GroupBy(field SqlField) SqlBuilderOption {
	return func(b *SqlQuery) {
		b.groupBy = append(b.groupBy, field)
	}
}

func OrderBy(field SqlField) SqlBuilderOption {
	return func(b *SqlQuery) {
		b.orderBy = append(b.orderBy, field)
	}
}

func Limit(limit int) SqlBuilderOption {
	return func(b *SqlQuery) {
		b.limit = limit
	}
}

func New(opts ...SqlBuilderOption) *SqlQuery {
	b := &SqlQuery{}
	for _, opt := range opts {
		opt(b)
	}
	return b
}
func (b *SqlQuery) With(opts ...SqlBuilderOption) SqlQueryable {
	cloned := *b
	for _, opt := range opts {
		opt(&cloned)
	}
	return &cloned
}

func (b *SqlQuery) ShouldSkipFilters() bool {
	return b.shouldSkipFilters
}

func (b *SqlQuery) Build() string {
	var sb strings.Builder

	// Write query name comment
	sb.WriteString(fmt.Sprintf("-- WARNING: This is an auto-generated query file, generated from TODO.\n"))
	sb.WriteString(fmt.Sprintf("-- DO NOT MODIFY MANUALLY; as changes will be overwritten\n"))

	// Write SELECT clause
	sb.WriteString("SELECT\n")

	if len(b.selectF) == 0 {
		sb.WriteString("    *\n")
	} else {
		for i, field := range b.selectF {
			definition := field.Definition()
			alias := field.Alias()

			sb.WriteString("    ")
			sb.WriteString(definition)

			if alias != definition {
				sb.WriteString(" AS ")
				sb.WriteString(alias)
			}

			// Add comma if not the last field
			if i < len(b.selectF)-1 {
				sb.WriteString(",")
			}
			sb.WriteString("\n")
		}
	}

	// Write FROM clause
	if b.from != "" {
		sb.WriteString("FROM\n")
		sb.WriteString(fmt.Sprintf("    %s\n", b.from))
	}

	// Write WHERE clause
	if len(b.where) > 0 {
		sb.WriteString("WHERE\n")
		for i, clause := range b.where {
			if i == 0 {
				sb.WriteString(fmt.Sprintf("    %s\n", clause))
			} else {
				sb.WriteString(fmt.Sprintf("    AND %s\n", clause))
			}
		}
	}

	if len(b.groupBy) > 0 {
		sb.WriteString("GROUP BY\n")
		for i, clause := range b.groupBy {
			sb.WriteString(fmt.Sprintf("    %s", clause.Alias()))

			if i < len(b.groupBy)-1 {
				sb.WriteString(",")
			}
			sb.WriteString("\n")
		}
	}

	if len(b.orderBy) > 0 {
		sb.WriteString("ORDER BY\n")
		for i, clause := range b.orderBy {
			sb.WriteString(fmt.Sprintf("    %s", clause.Alias()))

			if i < len(b.orderBy)-1 {
				sb.WriteString(",")
			}
			sb.WriteString("\n")
		}
	}

	if b.limit > 0 {
		sb.WriteString(fmt.Sprintf("LIMIT %d\n", b.limit))
	}

	// Remove trailing newline and add semicolon
	query := strings.TrimRight(sb.String(), "\n")
	query += ";"

	return query
}
