package sql

import (
	"fmt"
	"os"
	"strings"
)

// DashicaFiltersPlaceholder is replaced inside .sql files with the AND-joined Where()
// clauses attached to the SqlFile via With(...). When no Where() options were attached,
// it is replaced with "1=1" so the SQL stays valid. Files that don't use the placeholder
// are not modified.
const DashicaFiltersPlaceholder = "{{DASHICA_FILTERS}}"

// SqlFile represents a SQL query loaded from a file
type SqlFile struct {
	path              string
	shouldSkipFilters bool
	where             []string
}

func (f *SqlFile) ShouldSkipFilters() bool {
	return f.shouldSkipFilters
}

// FromFile creates a new SqlFile from the given path
func FromFile(path string) *SqlFile {
	return &SqlFile{
		path: path,
	}
}

// FromFileWithoutFilters skips dashboard filter handling entirely (including
// __from/__to parameter injection and time-range resolution).
func FromFileWithoutFilters(path string) *SqlFile {
	return &SqlFile{
		path:              path,
		shouldSkipFilters: true,
	}
}

// Build returns the SQL content from the file, with DASHICA_FILTERS placeholders
// substituted by the AND-joined Where() clauses attached via With(...).
func (f *SqlFile) Build() string {
	content, err := os.ReadFile(f.path)
	if err != nil {
		panic(fmt.Sprintf("failed to read SQL file %s: %v", f.path, err))
	}

	var clause string
	if len(f.where) == 0 {
		clause = "1=1"
	} else {
		parts := make([]string, len(f.where))
		for i, w := range f.where {
			parts[i] = "(" + w + ")"
		}
		clause = strings.Join(parts, " AND ")
	}
	return strings.ReplaceAll(string(content), DashicaFiltersPlaceholder, clause)
}

// With applies SqlBuilderOptions. Only Where() clauses are meaningful for SqlFile —
// they get substituted into DASHICA_FILTERS placeholders by Build(). Other options
// (Select, From, GroupBy, ...) are ignored because the file's SQL is already complete.
func (b *SqlFile) With(opts ...SqlBuilderOption) SqlQueryable {
	cloned := *b
	cloned.where = append([]string(nil), b.where...)
	// Run the options against a throwaway SqlQuery so the *same* option functions
	// can target both query types — this captures Where() additions into proxy.where.
	proxy := &SqlQuery{where: cloned.where}
	for _, opt := range opts {
		opt(proxy)
	}
	cloned.where = proxy.where
	return &cloned
}

// SqlQueryable is an interface for anything that can produce SQL
// TODO RENAME
type SqlQueryable interface {
	Build() string
	With(opts ...SqlBuilderOption) SqlQueryable
	ShouldSkipFilters() bool
}

var _ SqlQueryable = (*SqlQuery)(nil)
var _ SqlQueryable = (*SqlFile)(nil)
