package field

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

func JsonExtractString(jsonStrField string, paths ...string) Field {
	quotedPaths := make([]string, len(paths))
	for i, path := range paths {
		quotedPaths[i] = fmt.Sprintf("'%s'", path)
	}

	return &fieldImpl{
		definition: fmt.Sprintf("JSONExtractString(%s, %s)", jsonStrField, strings.Join(quotedPaths, ", ")),
		alias:      paths[len(paths)-1],
	}
}

func Count() Field {
	return &fieldImpl{
		definition: "count(*)",
		alias:      "cnt",
	}
}
