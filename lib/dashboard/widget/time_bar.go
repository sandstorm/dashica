package widget

import (
	"fmt"
	"net/http"

	"github.com/a-h/templ"
	"github.com/sandstorm/dashica/lib/components/widget_component"
	"github.com/sandstorm/dashica/lib/util/handler_collector"

	"github.com/sandstorm/dashica/lib/dashboard/sql"
)

type TimeBar struct {
	sql   sql.SqlBuilder
	x     sql.TimestampedField
	y     sql.Field
	title string
	id    string
}

func (b *TimeBar) X(xField sql.TimestampedField) *TimeBar {
	cloned := *b
	cloned.x = xField
	return &cloned
}

func (b *TimeBar) Y(yField sql.Field) *TimeBar {
	cloned := *b
	cloned.y = yField
	return &cloned
}
func (b *TimeBar) Id(id string) *TimeBar {
	cloned := *b
	cloned.id = id
	return &cloned
}

func NewTimeBar(sql sql.SqlBuilder) *TimeBar {
	return &TimeBar{
		sql: sql,
	}
}

func (b *TimeBar) Render() templ.Component {
	return widget_component.TimeBar()
}

func (b *TimeBar) CollectHandlers(registerHandler handler_collector.HandlerCollector) error {
	if len(b.id) == 0 {
		return fmt.Errorf("timeBar: id is required")
	}
	err := registerHandler.Handle(b.id, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		println("TIME BAR HANDLER CALLED")
	}))
	if err != nil {
		return fmt.Errorf("timeBar: %w", err)
	}
	return nil
}

/*func (b *baseBuilder) renderJs(queryName string, text string) {
	tpl := template.Must(template.New(queryName).Parse(text))

	fmt.Println("```js")
	renderContext := &RenderContext{
		sqlPath: "/",
	}
	err := tpl.Execute(os.Stdout, renderContext)
	if err != nil {
		log.Fatalln("ERROR: ", err)
	}

	fmt.Println("```")
}*/

/*func (b TimeBar) Build(dashboardEnv dashboard.DashboardEnv, queryName string) {
b.sql.
	PrependSelect(b.x).
	GroupBy(b.x).
	Select(b.y).
	Build(dashboardEnv, queryName)

b.title = "Bla"

// Write query name comment
/*fmt.Printf("```js\n")
fmt.Printf("display\n")
fmt.Printf("    chart.timeBar(\n")
fmt.Printf("        await clickhouse.query(%s, {}),\n", marshal("/" + dashboardEnv.SqlScriptPath(queryName))
fmt.Printf("        await clickhouse.query(\n")
fmt.Printf("```\n")
fmt.Printf("-- DO NOT MODIFY MANUALLY; as changes will be overwritten\n"))*/

/*	b.renderJs(dashboardEnv, queryName, `
display(
	chart.timeBar(
		await clickhouse.query(
			{{ js .sqlPath }},
			{ filters }
		), {
			viewOptions, invalidation,
			title: {{ js .b.title }},
			height: 250,
			x: {{ js .b.x.Alias }},
			xBucketSize: {{ js .b.x.XBucketSizeMs }},
			y: {{ js .b.y.Alias }}
		}
	)
);
`)
}*/

var _ InteractiveWidget = (*TimeBar)(nil)
