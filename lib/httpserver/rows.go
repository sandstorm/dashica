package httpserver

import (
	"net/http"

	"github.com/sandstorm/dashica/lib/clickhouse"
	"github.com/sandstorm/dashica/lib/dashboard/filter"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
)

// HandleRows answers `queryObj` as HandleQuery does, in Arrow with every column of a plain Arrow type
// (clickhouse.PlainArrowCast), which the Explore view's Perspective reads.
func (qh QueryHandler) HandleRows(queryObj sql.SqlQueryable, state QueryState, diagnostics filter.Diagnostics, w http.ResponseWriter, r *http.Request) error {
	return qh.answerArrow(queryObj, state, diagnostics, clickhouse.PlainArrowCast, w, r)
}
