package widget

import (
	"context"
	"fmt"
	"html"
	"io"
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
	table string
	title string
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
	if !schemaTableNamePattern.MatchString(s.table) {
		return s.errorComponent(fmt.Sprintf("invalid table name %q", s.table)), nil
	}

	client, err := ctx.Deps.ClickhouseClientManager.GetClient("default")
	if err != nil {
		return s.errorComponent(fmt.Sprintf("get clickhouse client: %s", err)), nil
	}

	result, err := clickhouse.QueryJSONFirst[showTableStructureResult](
		context.Background(),
		client,
		fmt.Sprintf("SHOW CREATE TABLE %s", s.table),
		clickhouse.DefaultQueryOptions(),
	)
	if err != nil {
		return s.errorComponent(fmt.Sprintf("SHOW CREATE TABLE %s: %s", s.table, err)), nil
	}

	htmlOut := fmt.Sprintf(
		`<pre class="text-xs overflow-x-auto p-3 bg-base-200 rounded">%s</pre>`,
		html.EscapeString(result.Statement),
	)
	return widget_component.Markdown(s.title, htmlOut), nil
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
