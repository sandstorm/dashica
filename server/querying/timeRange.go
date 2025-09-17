package querying

import (
	"github.com/sandstorm/dashica/server/util"
	"time"
)

type TimeRange struct {
	// From start time in UNIX milliseconds (inclusive)
	From *int64 `json:"from"`
	// From end time in UNIX milliseconds (exclusive)
	To *int64 `json:"to"`
}

func (r *TimeRange) WidthS() int64 {
	return r.WidthMs() / 1000
}

func (r *TimeRange) WidthMs() int64 {
	from, to := r.From, r.To
	if from == nil {
		from = util.Int64P(0)
	}
	if to == nil {
		to = util.Int64P(time.Now().Unix() * 1000)
	}
	return *to - *from
}
