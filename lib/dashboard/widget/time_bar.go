package widget

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"text/template"

	//"github.com/sandstorm/dashica/dashboard"
	"github.com/sandstorm/dashica/lib/dashboard/field"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
)

type TimeBarBuilder interface {
	X(xField field.TimestampedField) TimeBarBuilder
	Y(yField field.Field) TimeBarBuilder
}

type baseBuilder struct {
}

type builderImpl struct {
	baseBuilder
	sql   sql.SqlBuilder
	x     field.TimestampedField
	y     field.Field
	title string
}

func (b *builderImpl) X(xField field.TimestampedField) TimeBarBuilder {
	cloned := *b
	cloned.x = xField
	return &cloned
}

func (b *builderImpl) Y(yField field.Field) TimeBarBuilder {
	cloned := *b
	cloned.y = yField
	return &cloned
}

func NewTimeBar(sql sql.SqlBuilder) TimeBarBuilder {
	return &builderImpl{
		sql: sql,
	}
}

type RenderContext struct {
	sqlPath string
	b       interface{}
}

func (b *baseBuilder) renderJs(queryName string, text string) {
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
}

/*func (b builderImpl) Build(dashboardEnv dashboard.DashboardEnv, queryName string) {
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

func marshal(input any) string {
	res, err := json.Marshal(input)
	if err != nil {
		log.Fatalln("ERRORR", err)
	}
	return string(res)
}

var _ TimeBarBuilder = &builderImpl{}
