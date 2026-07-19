package sql

type rawString struct {
	s string
}

// RawString wraps a literal SQL string as a SqlQueryable. Build() returns the
// string unchanged; With() is a no-op; ShouldSkipFilters returns true.
// Intended for tests that need to inline SQL without the full builder.
func RawString(s string) SqlQueryable {
	return &rawString{s: s}
}

func (r *rawString) Build() string                                { return r.s }
func (r *rawString) With(_ ...SqlBuilderOption) SqlQueryable      { return r }
func (r *rawString) AdjustBuckets(_ int64) (SqlQueryable, *int64) { return r, nil }
func (r *rawString) ShouldSkipFilters() bool                      { return true }
func (r *rawString) Database() string                             { return "" }
