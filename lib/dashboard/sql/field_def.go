package sql

type SqlField interface {
	Definition() string
	Alias() string
	WithAlias(s string) SqlField
}

func Field(definition string) SqlField {
	return &fieldImpl{definition: definition, alias: definition}
}

type TimestampedField interface {
	SqlField
	XBucketSizeMs() int64
}

type fieldImpl struct {
	definition              string
	alias                   string
	timestamp_xBucketSizeMs int64
}

func (f *fieldImpl) WithAlias(s string) SqlField {
	cloned := *f
	cloned.alias = s
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
