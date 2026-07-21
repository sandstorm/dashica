package explore

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strconv"

	"github.com/sandstorm/dashica/lib/clickhouse"
)

// valuesLimit caps the number of distinct values returned; the endpoint feeds
// autocomplete (enum fills, color mappings), where a short, most-frequent list
// is what is useful.
const valuesLimit = 100

// identRe matches a safe ClickHouse identifier (column / table name). Value
// sampling interpolates the table and column into SQL, so both are validated
// against this before use — the search bar already lets the browser send raw
// SQL, but there is no reason to add an injection point here.
var identRe = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

// ValueCount is one distinct value and how often it occurs.
type ValueCount struct {
	Value string `json:"value"`
	Count int64  `json:"count"`
}

// handleValues serves the top distinct values of a column, most-frequent first,
// for autocomplete. GET /explore/api/values?table=&column=
func (e *exploreImpl) handleValues(w http.ResponseWriter, r *http.Request) error {
	table := r.URL.Query().Get("table")
	column := r.URL.Query().Get("column")
	if table == "" || column == "" {
		return fmt.Errorf("values: 'table' and 'column' query args are required")
	}
	if !identRe.MatchString(table) || !identRe.MatchString(column) {
		return fmt.Errorf("values: invalid table or column identifier")
	}

	client, err := e.deps.ClickhouseClientManager.GetClient("default")
	if err != nil {
		return fmt.Errorf("fetching clickhouse client: %w", err)
	}

	query := fmt.Sprintf(
		"SELECT toString(`%s`) AS value, count() AS count FROM `%s` GROUP BY value ORDER BY count DESC LIMIT %s",
		column, table, strconv.Itoa(valuesLimit),
	)
	type row struct {
		Value string      `json:"value"`
		Count json.Number `json:"count"`
	}
	opts := clickhouse.DefaultQueryOptions()
	res, err := clickhouse.QueryJSON[row](r.Context(), client, query, opts)
	if err != nil {
		return fmt.Errorf("querying values: %w", err)
	}

	out := make([]ValueCount, 0, len(res.Data))
	for _, ro := range res.Data {
		n, _ := ro.Count.Int64()
		out = append(out, ValueCount{Value: ro.Value, Count: n})
	}
	w.Header().Set("Content-Type", "application/json")
	return json.NewEncoder(w).Encode(out)
}
