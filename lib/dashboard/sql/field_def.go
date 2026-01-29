package sql

type SqlField interface {
	Definition() string
	Alias() string
	WithAlias(alias string) SqlField
}

func Field(definition string) SqlField {
	return &fieldImpl{definition: definition}
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

func (f *fieldImpl) XBucketSizeMs() int64 {
	return f.timestamp_xBucketSizeMs
}

func (f *fieldImpl) Definition() string {
	return f.definition
}

func (f *fieldImpl) Alias() string {
	return f.alias
}

func (f *fieldImpl) WithAlias(alias string) SqlField {
	cloned := *f
	cloned.alias = alias
	return &cloned
}

var _ SqlField = (*fieldImpl)(nil)
