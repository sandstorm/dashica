package widget

import (
	"context"
	"fmt"
	"html"
	"io"
	"net/http"
	"regexp"

	"github.com/a-h/templ"
	"github.com/sandstorm/dashica/lib/clickhouse"
	"github.com/sandstorm/dashica/lib/components/widget_component"
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

func (s *SchemaTable) BuildComponents(ctx *rendering.DashboardContext) (templ.Component, error) {
	statement, err := s.showCreateTable(context.Background(), ctx.Deps)
	if err != nil {
		return s.errorComponent(err.Error()), nil
	}

	htmlOut := fmt.Sprintf(
		`<pre class="text-xs overflow-x-auto p-3 bg-base-200 rounded">%s</pre>`,
		html.EscapeString(statement),
	)
	return widget_component.Markdown(s.title, htmlOut), nil
}

// Handler serves the table's CREATE TABLE statement as text at "/schema".
func (s *SchemaTable) Handler(deps rendering.Dependencies) http.Handler {
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

func (s *SchemaTable) errorComponent(msg string) templ.Component {
	htmlOut := fmt.Sprintf(
		`<pre class="text-xs text-error p-3 bg-base-200 rounded">%s</pre>`,
		html.EscapeString(msg),
	)
	return templ.ComponentFunc(func(_ context.Context, w io.Writer) error {
		_, err := io.WriteString(w, htmlOut)
		return err
	})
}

var _ WidgetDefinition = (*SchemaTable)(nil)
