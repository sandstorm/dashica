package sql

import (
	"fmt"
	"strings"
)

// defaultAutoBucketRounding is the rounding function applied to AutoBucket
// fields before AdjustBuckets has run (e.g. in tests, HandleDebug, or any
// path that calls Build() without first attaching a time range). 15-minute
// keeps Build() output valid SQL and preserves the previous default.
const defaultAutoBucketRounding = "toStartOfFifteenMinutes"
const defaultAutoBucketSizeMs = 15 * 60 * 1000

// AutoBucket declares a time bucket whose granularity follows the user's
// time-range filter. The chosen ClickHouse rounding function
// (toStartOfMinute, toStartOfHour, ...) is selected at request time based on
// the resolved time range.
//
// Use AutoBucket when you want the bucket size to follow the time range. Use
// Timestamp15Min / Timestamp5Min / TimestampField for a fixed bucket size.
//
// The alias defaults to "time"; use AutoBucketAs for a different alias.
func AutoBucket(column string) TimestampedField {
	return AutoBucketAs(column, "time")
}

// AutoBucketAs is AutoBucket with an explicit alias.
func AutoBucketAs(column, alias string) TimestampedField {
	return &autoBucketFieldImpl{
		column_:    column,
		alias_:     alias,
		definition: fmt.Sprintf("%s(%s)::DateTime64", defaultAutoBucketRounding, column),
		sizeMs:     defaultAutoBucketSizeMs,
	}
}

type autoBucketFieldImpl struct {
	column_    string
	alias_     string
	definition string
	sizeMs     int64
}

func (f *autoBucketFieldImpl) Definition() string   { return f.definition }
func (f *autoBucketFieldImpl) Alias() string        { return f.alias_ }
func (f *autoBucketFieldImpl) XBucketSizeMs() int64 { return f.sizeMs }
func (f *autoBucketFieldImpl) column() string       { return f.column_ }

func (f *autoBucketFieldImpl) WithAlias(s string) SqlField {
	cloned := *f
	cloned.alias_ = s
	return &cloned
}

func (f *autoBucketFieldImpl) withRounding(roundingFn string, sizeMs int64) autoBucketField {
	cloned := *f
	cloned.definition = fmt.Sprintf("%s(%s)::DateTime64", roundingFn, f.column_)
	cloned.sizeMs = sizeMs
	return &cloned
}

var _ autoBucketField = (*autoBucketFieldImpl)(nil)

func Timestamp15Min() TimestampedField {
	return &fieldImpl{
		definition:              "toStartOfFifteenMinutes(timestamp)::DateTime64",
		alias:                   "time",
		timestamp_xBucketSizeMs: 15 * 60 * 1000,
	}
}

func Timestamp5Min() TimestampedField {
	return &fieldImpl{
		definition:              "toStartOfInterval(timestamp, INTERVAL 5 MINUTE)::DateTime64",
		alias:                   "time",
		timestamp_xBucketSizeMs: 5 * 60 * 1000,
	}
}

// TimestampField builds a custom time-bucket field. Use the predefined Timestamp* helpers when possible.
func TimestampField(definition, alias string, xBucketSizeMs int64) TimestampedField {
	return &fieldImpl{
		definition:              definition,
		alias:                   alias,
		timestamp_xBucketSizeMs: xBucketSizeMs,
	}
}

func NewFieldAlias(alias string) TimestampedField {
	return &fieldImpl{
		definition: alias,
		alias:      alias,
	}
}

func NewTimestampedFieldAlias(alias string, xBucketSizeMs int64) TimestampedField {
	return &fieldImpl{
		definition:              alias,
		alias:                   alias,
		timestamp_xBucketSizeMs: xBucketSizeMs,
	}
}

func JsonExtractString(jsonStrField string, paths ...string) SqlField {
	quotedPaths := make([]string, len(paths))
	for i, path := range paths {
		quotedPaths[i] = fmt.Sprintf("'%s'", path)
	}

	return &fieldImpl{
		definition: fmt.Sprintf("JSONExtractString(%s, %s)", jsonStrField, strings.Join(quotedPaths, ", ")),
		alias:      paths[len(paths)-1],
	}
}

func Count() SqlField {
	return &fieldImpl{
		definition: "count(*)",
		alias:      "cnt",
	}
}

func Enum(field string) SqlField {
	return &fieldImpl{
		definition: fmt.Sprintf("%s::String", field),
		alias:      field,
	}
}
