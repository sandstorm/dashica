package httpserver

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/sandstorm/dashica/lib/clickhouse"
	"github.com/sandstorm/dashica/lib/dashboard/filter"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
)

// HandleRows answers `queryObj` as HandleQuery does, in Arrow with every column of a plain Arrow type
// (clickhouse.PlainArrowCast), which the Explore view's Perspective reads.
func (qh QueryHandler) HandleRows(queryObj sql.SqlQueryable, state QueryState, diagnostics filter.Diagnostics, w http.ResponseWriter, r *http.Request) error {
	return qh.answerArrow(queryObj, state, diagnostics, clickhouse.PlainArrowCast, w, r)
}

// HandleEditedRows answers the SQL `text` the viewer edited in the Explore view, as it is (spaces and one trailing `;`
// trimmed), on the ClickHouse connection of `queryObj` (its chart's), in the Arrow of HandleRows: read-only (an HTTP
// GET and `readonly=2`, so ClickHouse refuses writes and changes of `readonly` with READONLY), at most `limit` rows,
// said in X-Dashica-Rows-Limit. The limit is a LIMIT around the text (`SELECT * FROM (\n<text>\n) LIMIT <limit>`):
// exact, out of reach of the text's own SETTINGS, and its subqueries run in full. An empty text is a QueryStateError.
func (qh QueryHandler) HandleEditedRows(queryObj sql.SqlQueryable, text string, limit int, w http.ResponseWriter, r *http.Request) error {
	text = strings.TrimSuffix(strings.TrimSpace(text), ";")
	if strings.TrimSpace(text) == "" {
		return &QueryStateError{"xsql: the edited query is empty"}
	}
	client, err := qh.client(queryObj)
	if err != nil {
		return err
	}
	opts := clickhouse.DefaultQueryOptions()
	opts.Settings["output_format_arrow_compression_method"] = "none" // compression not supported by arrow JS
	opts.Settings["date_time_input_format"] = "best_effort"
	opts.Settings["readonly"] = "2"
	opts.Cast = clickhouse.PlainArrowCast
	w.Header().Set("X-Dashica-Rows-Limit", strconv.Itoa(limit))
	if err := client.QueryToHandler(r.Context(), limited(text, limit), opts, w); err != nil {
		return fmt.Errorf("clickhouse query: %w", err)
	}
	return nil
}

// limited is the query `text` with at most `limit` rows: a LIMIT around it, on lines of its own, so a trailing
// `-- comment` in the text ends before the `)`.
func limited(text string, limit int) string {
	return "SELECT * FROM (\n" + text + "\n) LIMIT " + strconv.Itoa(limit)
}
