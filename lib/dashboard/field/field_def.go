package field

type Field interface {
	Definition() string
	Alias() string
	WithAlias(alias string) Field
}

type TimestampedField interface {
	Field
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

func (f *fieldImpl) WithAlias(alias string) Field {
	cloned := *f
	cloned.alias = alias
	return &cloned
}

var _ Field = (*fieldImpl)(nil)
