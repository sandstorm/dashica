package httpserver

import (
	"errors"
	"fmt"
	"maps"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/sandstorm/dashica/lib/clickhouse"
	"github.com/sandstorm/dashica/lib/dashboard/filter"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
)

// ErrExploreNotEnabled is what HandleSql and HandleEditedRows answer while explore.enabled is off, before any query:
// a 404.
var ErrExploreNotEnabled = errors.New("Explore is not enabled (explore.enabled)")

// HandleRows answers `queryObj` as HandleQuery does, in Arrow with every column of a plain Arrow type
// (clickhouse.PlainArrowCast), which the Explore view's Perspective reads.
func (qh QueryHandler) HandleRows(queryObj sql.SqlQueryable, state QueryState, diagnostics filter.Diagnostics, w http.ResponseWriter, r *http.Request) error {
	return qh.answerArrow(queryObj, state, diagnostics, clickhouse.PlainArrowCast, w, r)
}

// HandleEditedRows answers the SQL `text` the viewer edited in the Explore view, as it is (spaces and one trailing `;`
// trimmed), its placeholders bound to `params` (EditedParameters), on the ClickHouse connection of `queryObj` (its
// chart's), in the Arrow of HandleRows: read-only (an HTTP GET and `readonly=2`, so ClickHouse refuses writes and
// changes of `readonly` with READONLY), at most `limit` rows, said in X-Dashica-Rows-Limit. The limit is a LIMIT around
// the text (`SELECT * FROM (\n<text>\n) LIMIT <limit>`): exact, out of reach of the text's own SETTINGS, and its
// subqueries run in full. ErrExploreNotEnabled unless qh.ExploreEnabled; an empty text is a QueryStateError.
func (qh QueryHandler) HandleEditedRows(queryObj sql.SqlQueryable, text string, params map[string]string, limit int, w http.ResponseWriter, r *http.Request) error {
	if !qh.ExploreEnabled {
		return ErrExploreNotEnabled
	}
	text = strings.TrimSuffix(strings.TrimSpace(text), ";")
	if strings.TrimSpace(text) == "" {
		return &QueryStateError{"exploreSql: the edited query is empty"}
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
	maps.Copy(opts.Parameters, params)
	w.Header().Set("X-Dashica-Rows-Limit", strconv.Itoa(limit))
	if err := client.QueryToHandler(r.Context(), limited(text, limit), opts, w); err != nil {
		return fmt.Errorf("clickhouse query: %w", err)
	}
	return nil
}

// EditedParameters are the values an edited query's placeholders are bound to, from the request's `param_<name>`
// keys (`param___from=1761724800` binds `{__from:DateTime64}`), as ClickHouse's HTTP interface names them.
func EditedParameters(values url.Values) map[string]string {
	params := map[string]string{}
	for key, value := range values {
		if name, ok := strings.CutPrefix(key, "param_"); ok && name != "" && len(value) > 0 {
			params[name] = value[0]
		}
	}
	return params
}

// limited is the query `text` with at most `limit` rows: a LIMIT around it, on lines of its own, so a trailing
// `-- comment` in the text ends before the `)`.
func limited(text string, limit int) string {
	return "SELECT * FROM (\n" + text + "\n) LIMIT " + strconv.Itoa(limit)
}
