package querying

import (
	"github.com/sandstorm/dashica/server/util"
	"regexp"
	"strings"
)

var Bucketing = &bucketingImpl{
	bucketPattern: regexp.MustCompile(`(?i)bucket:\s*(\S+)\s*`),
	maxBuckets:    720 + 1, // one month hourly buckets
	bucketSizes: []bucketSize{
		{widthS: 1, roundingFn: "toStartOfSecond"},
		{widthS: 60, roundingFn: "toStartOfMinute"},
		{widthS: 5 * 60, roundingFn: "toStartOfFiveMinutes"},
		{widthS: 15 * 60, roundingFn: "toStartOfFifteenMinutes"},
		{widthS: 60 * 60, roundingFn: "toStartOfHour"},
		{widthS: 24 * 60 * 60, roundingFn: "toStartOfDay"},
		{widthS: 7 * 24 * 60 * 60, roundingFn: "toStartOfWeek"},
	},
}

type bucketingImpl struct {
	bucketPattern *regexp.Regexp
	maxBuckets    int64
	bucketSizes   []bucketSize
}

type bucketSize struct {
	widthS     int64
	roundingFn string
}

type SqlQuery = string
type BucketSizeMs = int64

func (b *bucketingImpl) AdjustBucketSizeInQuery(query string, timeRange *TimeRange) (SqlQuery, *BucketSizeMs) {
	// 1) check if we have everything we need
	if timeRange == nil {
		return query, nil // No time range provided, return original query
	}
	matches := b.bucketPattern.FindStringSubmatch(query)
	if len(matches) < 2 {
		return query, nil // No bucket specified, return original query
	}
	bucketSubstring := matches[1]
	if !strings.Contains(bucketSubstring, "toStartOfFifteenMinutes") {
		return query, nil // needle to replace missing
	}

	// 2) find target roundingFn
	widthS := timeRange.WidthS()
	var size *bucketSize
	for _, s := range b.bucketSizes {
		// smallest bucket within the limit
		buckets := widthS / s.widthS
		if buckets <= b.maxBuckets {
			size = &s
			break
		}
	}
	if size == nil {
		size = &b.bucketSizes[len(b.bucketSizes)-1]
	}

	// 3) replace bucket size in query
	newBucketSubstring := strings.ReplaceAll(bucketSubstring, "toStartOfFifteenMinutes", size.roundingFn)
	newQuery := strings.ReplaceAll(query, bucketSubstring, newBucketSubstring)

	return newQuery, util.Int64P(size.widthS * 1000)
}
