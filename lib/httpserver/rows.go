package httpserver

import (
	"errors"
	"fmt"
	"maps"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"

	"github.com/sandstorm/dashica/lib/clickhouse"
	"github.com/sandstorm/dashica/lib/dashboard/filter"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
)

// ErrExploreNotEnabled is what HandleSql, HandleEditedRows and ConnectionRowsHandler answer while explore.enabled is off, before any query:
// a 404.
var ErrExploreNotEnabled = errors.New("Explore is not enabled (explore.enabled)")

// HandleRows answers `queryObj` as HandleQuery does, in Arrow with every column of a plain Arrow type
// (clickhouse.PlainArrowCast), which the Explore view's Perspective reads.
func (qh QueryHandler) HandleRows(queryObj sql.SqlQueryable, state QueryState, diagnostics filter.Diagnostics, w http.ResponseWriter, r *http.Request) error {
	return qh.answerArrow(queryObj, state, diagnostics, clickhouse.PlainArrowCast, w, r)
}

// ExploreRowLimit is the number of rows an edited query (`<dataUrl>/rows?exploreSql=`, `/rows?connection=`) answers at
// most.
const ExploreRowLimit = 100_000

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
	text, err := editedText(text)
	if err != nil {
		return err
	}
	client, err := qh.client(queryObj)
	if err != nil {
		return err
	}
	return answerEdited(client, text, params, limit, w, r)
}

// ConnectionRowsHandler answers `GET /rows?connection=<name>&exploreSql=<text>&param_<name>=…`, the query of a blank
// Explore tab, which no chart runs (docs/2026-10-30-perspective.md §4.8): `text` on that connection of dashica_config,
// as HandleEditedRows answers an edited query (read-only, at most ExploreRowLimit rows, the Arrow of HandleRows). 404
// while explore.enabled is off (ErrExploreNotEnabled, before any query) and for a connection dashica_config does not
// name; 400 for an empty text.
type ConnectionRowsHandler struct {
	ClickhouseClientManager *clickhouse.Manager
	// ExploreEnabled: it answers (explore.enabled).
	ExploreEnabled bool
}

func (h ConnectionRowsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !h.ExploreEnabled {
		http.Error(w, ErrExploreNotEnabled.Error(), http.StatusNotFound)
		return
	}
	args := r.URL.Query()
	connection := args.Get("connection")
	if !slices.Contains(h.ClickhouseClientManager.Connections(), connection) {
		http.Error(w, fmt.Sprintf("no connection %q in dashica_config", connection), http.StatusNotFound)
		return
	}
	text, err := editedText(args.Get("exploreSql"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	client, err := h.ClickhouseClientManager.GetClient(connection)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := answerEdited(client, text, EditedParameters(args), ExploreRowLimit, w, r); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

// editedText is `text` without its spaces around and one trailing `;`; a QueryStateError when nothing is left.
func editedText(text string) (string, error) {
	text = strings.TrimSuffix(strings.TrimSpace(text), ";")
	if strings.TrimSpace(text) == "" {
		return "", &QueryStateError{"exploreSql: the edited query is empty"}
	}
	return text, nil
}

// answerEdited answers `text` on `client`, its placeholders bound to `params`, read-only and at most `limit` rows, in
// plain Arrow types (HandleEditedRows).
func answerEdited(client *clickhouse.Client, text string, params map[string]string, limit int, w http.ResponseWriter, r *http.Request) error {
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
