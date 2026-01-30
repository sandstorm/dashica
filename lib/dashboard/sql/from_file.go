package sql

import (
	"fmt"
	"os"
)

// SqlFile represents a SQL query loaded from a file
type SqlFile struct {
	path string
}

// FromFile creates a new SqlFile from the given path
func FromFile(path string) *SqlFile {
	return &SqlFile{
		path: path,
	}
}

// Build returns the SQL content from the file
func (f *SqlFile) Build() string {
	content, err := os.ReadFile(f.path)
	if err != nil {
		panic(fmt.Sprintf("failed to read SQL file %s: %v", f.path, err))
	}

	return string(content)
}

func (b *SqlFile) With(opts ...SqlBuilderOption) SqlQueryable {
	// TODO: IGNORE ME; AS THE SQL QUERY IN THE FILE IS ALREADY COMPLETE
	return b
}

// SqlQueryable is an interface for anything that can produce SQL
// TODO RENAME
type SqlQueryable interface {
	Build() string
	With(opts ...SqlBuilderOption) SqlQueryable
}

var _ SqlQueryable = (*SqlQuery)(nil)
var _ SqlQueryable = (*SqlFile)(nil)
