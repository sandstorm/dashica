package sql

type SqlField interface {
	Definition() string
	Alias() string
	WithAlias(s string) SqlField
	// FilterAs is the field whose pill (a filter on the value it shows, docs/2026-10-28-workbench.md §3.8) is the
	// condition `condition` writes for that value, in place of `<definition> = <quoted value>`: for a computed field
	// whose column filters faster, `sql.Field("replace(customer_project, 'customer-', '')").WithAlias("customer").
	// FilterAs(func(value string) string { return "customer_project = " + sql.Quote("customer-"+value) })`. The
	// condition quotes the value itself (Quote). A time bucket stays one that cannot filter.
	FilterAs(condition func(value string) string) SqlField
}

func Field(definition string) SqlField {
	return &fieldImpl{kind: kindExpr, definition: definition, alias: definition}
}

type TimestampedField interface {
	SqlField
	XBucketSizeMs() int64
}

type fieldImpl struct {
	definition              string
	alias                   string
	timestamp_xBucketSizeMs int64
	// kind names the semantic constructor that produced this field ("count",
	// "enum", "expr", ...). It is metadata only: serialization and Build() never
	// depend on it, but it lets the Explore code generator emit the idiomatic
	// constructor (sql.Count()) instead of the baked expression
	// (sql.Field("count(*)")), and lets the editor label the field. Empty is
	// treated as "expr".
	kind fieldKind
	// filterAs is the condition of its pill for a value (FilterAs); nil: `(<definition>) = <quoted value>`. Go only,
	// so it is not serialized.
	filterAs func(value string) string
}

func (f *fieldImpl) WithAlias(s string) SqlField {
	cloned := *f
	cloned.alias = s
	return &cloned
}

func (f *fieldImpl) FilterAs(condition func(value string) string) SqlField {
	cloned := *f
	cloned.filterAs = condition
	return &cloned
}

func (f *fieldImpl) XBucketSizeMs() int64 {
	return f.timestamp_xBucketSizeMs
}

func (f *fieldImpl) Definition() string {
	return f.definition
}

func (f *fieldImpl) Alias() string {
	return f.alias
}

var _ SqlField = (*fieldImpl)(nil)

// autoBucketField is implemented by fields produced by AutoBucket / AutoBucketAs.
// The interface is unexported so only fields built via those constructors can
// participate in auto-granularity adjustment.
type autoBucketField interface {
	TimestampedField
	column() string
	withRounding(roundingFn string, sizeMs int64) autoBucketField
}
