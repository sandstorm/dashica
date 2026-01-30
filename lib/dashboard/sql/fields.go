package sql

import (
	"fmt"
	"strings"
)

func Timestamp15Min() TimestampedField {
	return &fieldImpl{
		definition:              "toStartOfFifteenMinutes(timestamp)::DateTime64",
		alias:                   "time",
		timestamp_xBucketSizeMs: 15 * 60 * 1000,
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
