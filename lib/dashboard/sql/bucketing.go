package sql

// bucketSize describes one rung of the auto-granularity ladder.
type bucketSize struct {
	widthS     int64
	roundingFn string
}

// bucketSizes is the ladder of available granularities, ordered from finest to
// coarsest. selectBucket walks it and picks the smallest entry whose bucket
// count over the requested time-range width stays within maxBuckets.
var bucketSizes = []bucketSize{
	{widthS: 1, roundingFn: "toStartOfSecond"},
	{widthS: 60, roundingFn: "toStartOfMinute"},
	{widthS: 5 * 60, roundingFn: "toStartOfFiveMinutes"},
	{widthS: 15 * 60, roundingFn: "toStartOfFifteenMinutes"},
	{widthS: 60 * 60, roundingFn: "toStartOfHour"},
	{widthS: 24 * 60 * 60, roundingFn: "toStartOfDay"},
	{widthS: 7 * 24 * 60 * 60, roundingFn: "toStartOfWeek"},
}

const maxBuckets int64 = 720 + 1 // one month at hourly granularity

// bucketSelector picks a ClickHouse rounding function for the given time-range
// width. Returns the rounding function name and the bucket width in seconds.
//
// Exposed as a package-level var so tests can swap it; production code calls it
// transparently via SqlQuery.AdjustBuckets / SqlFile.AdjustBuckets.
var bucketSelector = func(widthS int64) (roundingFn string, sizeS int64) {
	var size *bucketSize
	for _, s := range bucketSizes {
		buckets := widthS / s.widthS
		if buckets <= maxBuckets {
			size = &s
			break
		}
	}
	if size == nil {
		size = &bucketSizes[len(bucketSizes)-1]
	}
	return size.roundingFn, size.widthS
}
