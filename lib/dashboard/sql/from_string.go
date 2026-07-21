package sql

import (
	"fmt"
	"io/fs"
	"strings"
)

// SqlString is like SqlFile but carries its SQL inline instead of reading it
// from the project filesystem. It exists for the Explore builder, which
// composes raw SQL in the browser and cannot write files into the embedded
// projectFS. The same {{DASHICA_FILTERS}} enforcement as SqlFile applies, so an
// inline query is subject to dashboard time-range and user filters exactly like
// a file-backed one.
type SqlString struct {
	content           string
	shouldSkipFilters bool
	where             []string
	database          string

	// auto-bucket placeholder substitution (mirrors SqlFile)
	autoBucket     bool   // opt-in via AutoBucketPlaceholder()
	bucketRounding string // chosen rounding fn after AdjustBuckets; "" means not yet adjusted
}

// FromString creates a SqlString from inline SQL. The content MUST contain the
// {{DASHICA_FILTERS}} placeholder so dashboard time-range and user filters are
// applied (checked in BuildWithFS). Use FromStringWithoutFilters for queries
// that must not be filtered.
func FromString(content string) *SqlString {
	return &SqlString{
		content: content,
	}
}

// FromStringWithoutFilters is the explicit opt-out from dashboard filter
// handling, mirroring FromFileWithoutFilters.
func FromStringWithoutFilters(content string) *SqlString {
	return &SqlString{
		content:           content,
		shouldSkipFilters: true,
	}
}

func (s *SqlString) ShouldSkipFilters() bool {
	return s.shouldSkipFilters
}

func (s *SqlString) Database() string {
	return s.database
}

// Build returns the inline SQL with placeholders substituted. Unlike
// BuildWithFS it does not enforce the {{DASHICA_FILTERS}} placeholder (there is
// no error channel); production request handling goes through BuildWithFS.
func (s *SqlString) Build() string {
	return substitutePlaceholders(s.content, s.where, s.autoBucket, s.bucketRounding)
}

// BuildWithFS mirrors SqlFile.BuildWithFS: it enforces the {{DASHICA_FILTERS}}
// placeholder before substitution. The fileSystem argument is unused (the SQL
// is inline) but kept so SqlString satisfies the same request-time code path as
// SqlFile via the package BuildWithFS dispatcher.
func (s *SqlString) BuildWithFS(_ fs.ReadFileFS) (string, error) {
	if !s.shouldSkipFilters && !strings.Contains(s.content, DashicaFiltersPlaceholder) {
		return "", fmt.Errorf(
			"inline SQL does not contain the %s placeholder. "+
				"Add `WHERE %s` (or `AND %s` if a WHERE already exists) so the "+
				"dashboard's time range and user filters get applied. If this query "+
				"intentionally must not be filtered, use sql.FromStringWithoutFilters instead",
			DashicaFiltersPlaceholder, DashicaFiltersPlaceholder, DashicaFiltersPlaceholder,
		)
	}
	return substitutePlaceholders(s.content, s.where, s.autoBucket, s.bucketRounding), nil
}

// AdjustBuckets is a no-op unless AutoBucketPlaceholder() was attached; with
// opt-in it substitutes DashicaBucketPlaceholder with the rounding function
// picked for the given time-range width. Mirrors SqlFile.AdjustBuckets.
func (s *SqlString) AdjustBuckets(widthS int64) (SqlQueryable, *int64) {
	if !s.autoBucket {
		return s, nil
	}
	roundingFn, sizeS := bucketSelector(widthS)
	cloned := *s
	cloned.where = append([]string(nil), s.where...)
	cloned.bucketRounding = roundingFn
	sizeMs := sizeS * 1000
	return &cloned, &sizeMs
}

// With applies SqlBuilderOptions. As with SqlFile, only Where(), OnDatabase()
// and AutoBucketPlaceholder() are meaningful — the SQL is already complete.
func (s *SqlString) With(opts ...SqlBuilderOption) SqlQueryable {
	cloned := *s
	cloned.where = append([]string(nil), s.where...)
	proxy := &SqlQuery{where: cloned.where, database: cloned.database, autoBucketPlaceholder: cloned.autoBucket}
	for _, opt := range opts {
		opt(proxy)
	}
	cloned.where = proxy.where
	cloned.database = proxy.database
	cloned.autoBucket = proxy.autoBucketPlaceholder
	return &cloned
}

var _ SqlQueryable = (*SqlString)(nil)
