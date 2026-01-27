package sql

import (
	"fmt"
	"strings"

	fieldDef "github.com/sandstorm/dashica/lib/dashboard/field"
)

type SqlBuildCtx interface {
}

type SqlBuilder interface {
	Build(dashboardEnv SqlBuildCtx, queryName string)
	From(table string) SqlBuilder
	Where(clause string) SqlBuilder
	Select(field fieldDef.Field) SqlBuilder
	PrependSelect(field fieldDef.Field) SqlBuilder
	GroupBy(x fieldDef.Field) SqlBuilder
}

type builderImpl struct {
	selectF []fieldDef.Field
	from    string
	where   []string
	groupBy []fieldDef.Field
}

func New() SqlBuilder {
	return &builderImpl{}
}

func (b *builderImpl) Select(field fieldDef.Field) SqlBuilder {
	cloned := *b
	cloned.selectF = append(cloned.selectF, field)
	return &cloned
}

func (b *builderImpl) PrependSelect(field fieldDef.Field) SqlBuilder {
	cloned := *b
	cloned.selectF = append([]fieldDef.Field{field}, cloned.selectF...)
	return &cloned
}

func (b *builderImpl) From(table string) SqlBuilder {
	cloned := *b
	cloned.from = table
	return &cloned
}

func (b *builderImpl) Where(clause string) SqlBuilder {
	cloned := *b
	cloned.where = append(cloned.where, clause)
	return &cloned
}

func (b *builderImpl) GroupBy(field fieldDef.Field) SqlBuilder {
	cloned := *b
	cloned.groupBy = append(cloned.groupBy, field)
	return &cloned
}

func (b *builderImpl) Build(dashboardEnv SqlBuildCtx, queryName string) {
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

			if alias != "" {
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

	// Remove trailing newline and add semicolon
	query := strings.TrimRight(sb.String(), "\n")
	query += ";"

	//dashboardEnv.WriteSqlScript(queryName, query)
}

var _ SqlBuilder = &builderImpl{}
