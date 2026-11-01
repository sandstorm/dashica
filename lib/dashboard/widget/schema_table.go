package widget

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"regexp"

	"github.com/sandstorm/dashica/lib/clickhouse"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
)

// SchemaTable runs `SHOW CREATE TABLE <table>` against ClickHouse at render time and
// renders the resulting DDL inside a <pre> block. Useful for documenting the source
// table of a dashboard inline.
type SchemaTable struct {
	// table is the ClickHouse table name to run SHOW CREATE TABLE against.
	table string `dashica-gen:"client"`
	// title is the optional title rendered above the schema block.
	title string `dashica-gen:"client"`
}

// NewSchemaTable creates a new SchemaTable widget for the given table name.
func NewSchemaTable(table string) *SchemaTable {
	return &SchemaTable{table: table}
}

// Title sets an optional title rendered above the schema block.
func (s *SchemaTable) Title(title string) *SchemaTable {
	cloned := *s
	cloned.title = title
	return &cloned
}

var schemaTableNamePattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

type showTableStructureResult struct {
	Statement string `json:"statement"`
}

// Handler serves the table's CREATE TABLE statement as text at "/schema".
func (s *SchemaTable) Handler(deps rendering.Dependencies, _ string) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /schema", func(w http.ResponseWriter, r *http.Request) {
		statement, err := s.showCreateTable(r.Context(), deps)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = io.WriteString(w, statement)
	})
	return mux
}

// showCreateTable is what `SHOW CREATE TABLE <table>` answers on the default ClickHouse.
func (s *SchemaTable) showCreateTable(ctx context.Context, deps rendering.Dependencies) (string, error) {
	if !schemaTableNamePattern.MatchString(s.table) {
		return "", fmt.Errorf("invalid table name %q", s.table)
	}

	client, err := deps.ClickhouseClientManager.GetClient("default")
	if err != nil {
		return "", fmt.Errorf("get clickhouse client: %w", err)
	}

	result, err := clickhouse.QueryJSONFirst[showTableStructureResult](
		ctx,
		client,
		fmt.Sprintf("SHOW CREATE TABLE %s", s.table),
		clickhouse.DefaultQueryOptions(),
	)
	if err != nil {
		return "", fmt.Errorf("SHOW CREATE TABLE %s: %w", s.table, err)
	}
	return result.Statement, nil
}
