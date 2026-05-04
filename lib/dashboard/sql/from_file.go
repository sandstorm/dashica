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

// DashicaBucketPlaceholder is replaced inside .sql files with the ClickHouse rounding
// function chosen for the resolved time range (e.g. "toStartOfHour"), but only when
// the SqlFile is built with AutoBucketPlaceholder() attached via With(...). Without
// that opt-in any literal placeholder is left untouched and ClickHouse will fail to
// parse it — failing loud is preferable to a silent skip.
//
// Use it in SQL files like: `{{DASHICA_BUCKET}}(timestamp)::DateTime64`.
const DashicaBucketPlaceholder = "{{DASHICA_BUCKET}}"

// SqlFile represents a SQL query loaded from a file
type SqlFile struct {
	path              string
	shouldSkipFilters bool
	where             []string
	database          string

	// auto-bucket placeholder substitution
	autoBucket     bool   // opt-in via AutoBucketPlaceholder()
	bucketRounding string // chosen rounding fn after AdjustBuckets; "" means not yet adjusted
}

func (f *SqlFile) ShouldSkipFilters() bool {
	return f.shouldSkipFilters
}

func (f *SqlFile) Database() string {
	return f.database
}

// FromFile creates a new SqlFile from the given path. The file MUST contain the
// {{DASHICA_FILTERS}} placeholder so that dashboard time-range and user filters
// are applied — otherwise queries silently scan the full table. Files that
// genuinely should not be filtered (system tables, alerts that own their own
// WHERE, week-over-week comparisons, ...) must use FromFileWithoutFilters
// instead. This panics at construction time when the placeholder is missing,
// which surfaces the misconfiguration loudly at server startup.
func FromFile(path string) *SqlFile {
	content, err := os.ReadFile(path)
	if err != nil {
		panic(fmt.Sprintf("failed to read SQL file %s: %v", path, err))
	}
	if !strings.Contains(string(content), DashicaFiltersPlaceholder) {
		panic(fmt.Sprintf(
			"SQL file %s does not contain the %s placeholder. "+
				"Add `WHERE %s` (or `AND %s` if a WHERE already exists) so the "+
				"dashboard's time range and user filters get applied. If this query "+
				"intentionally must not be filtered (system tables, alerts that own "+
				"their WHERE, week-over-week comparisons, ...), use sql.FromFileWithoutFilters instead.",
			path, DashicaFiltersPlaceholder, DashicaFiltersPlaceholder, DashicaFiltersPlaceholder,
		))
	}
	return &SqlFile{
		path: path,
	}
}

// FromFileWithoutFilters is the explicit opt-out from dashboard filter handling.
// It skips __from/__to parameter injection, time-range resolution, and the
// {{DASHICA_FILTERS}} placeholder check. Use this only for queries that must
// not be filtered by the dashboard time range — e.g. queries against ClickHouse
// system tables, alerts that own their WHERE clause, or week-over-week
// comparisons that compute their own time bounds.
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
	out := strings.ReplaceAll(string(content), DashicaFiltersPlaceholder, clause)

	// Substitute the bucket placeholder only when AutoBucketPlaceholder() was attached
	// AND AdjustBuckets has chosen a rounding function. If the file uses the placeholder
	// without opt-in (or before adjustment), leave it as-is — ClickHouse will fail to
	// parse, surfacing the misconfiguration loudly.
	if f.autoBucket && f.bucketRounding != "" {
		out = strings.ReplaceAll(out, DashicaBucketPlaceholder, f.bucketRounding)
	}
	return out
}

// AdjustBuckets is a no-op when the SqlFile was not built with
// AutoBucketPlaceholder(). With opt-in, it substitutes DashicaBucketPlaceholder
// with the rounding function picked for the given time-range width.
func (f *SqlFile) AdjustBuckets(widthS int64) (SqlQueryable, *int64) {
	if !f.autoBucket {
		return f, nil
	}
	roundingFn, sizeS := bucketSelector(widthS)
	cloned := *f
	cloned.where = append([]string(nil), f.where...)
	cloned.bucketRounding = roundingFn
	sizeMs := sizeS * 1000
	return &cloned, &sizeMs
}

// With applies SqlBuilderOptions. Only Where() and OnDatabase() are meaningful for
// SqlFile — Where() clauses get substituted into DASHICA_FILTERS placeholders by
// Build(); OnDatabase() routes the query to a non-default ClickHouse. Other options
// (Select, From, GroupBy, ...) are ignored because the file's SQL is already complete.
func (b *SqlFile) With(opts ...SqlBuilderOption) SqlQueryable {
	cloned := *b
	cloned.where = append([]string(nil), b.where...)
	// Run the options against a throwaway SqlQuery so the *same* option functions
	// can target both query types — this captures Where() and OnDatabase() additions.
	proxy := &SqlQuery{where: cloned.where, database: cloned.database, autoBucketPlaceholder: cloned.autoBucket}
	for _, opt := range opts {
		opt(proxy)
	}
	cloned.where = proxy.where
	cloned.database = proxy.database
	cloned.autoBucket = proxy.autoBucketPlaceholder
	return &cloned
}

// SqlQueryable is an interface for anything that can produce SQL
// TODO RENAME
type SqlQueryable interface {
	Build() string
	With(opts ...SqlBuilderOption) SqlQueryable
	// AdjustBuckets returns a clone with auto-granularity bucket fields rebaked
	// for the given time-range width in seconds, plus the chosen bucket size in
	// milliseconds. Returns the receiver and nil when the query did not opt in
	// to auto-granularity.
	AdjustBuckets(widthS int64) (SqlQueryable, *int64)
	ShouldSkipFilters() bool
	// Database returns the ClickHouse server alias this query should run against,
	// or "" when it should use the "default" server.
	Database() string
}

var _ SqlQueryable = (*SqlQuery)(nil)
var _ SqlQueryable = (*SqlFile)(nil)
