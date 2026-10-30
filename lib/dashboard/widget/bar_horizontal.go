package widget

import (
	"github.com/sandstorm/dashica/lib/dashboard/color"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
)

// BarHorizontal: bars go from left to right. x is the value axis, y is the category axis.
type BarHorizontal struct {
	// sql is the underlying query builder; adjust it with AdjustQuery.
	sql sql.SqlQueryable
	// x is the measure plotted as bar length.
	x sql.SqlField `dashica-gen:"client,role=measure"`
	// y is the category (grouping) field, plotted on the vertical axis.
	y sql.SqlField `dashica-gen:"client,role=dimension"`
	// fill is the series bound to the color scale. Zero value: bars use a
	// single default color, or are colored by y when fy is set.
	fill *sql.SqlField `dashica-gen:"client,role=dimension"`
	// title is the chart title shown above the plot.
	title string `dashica-gen:"client"`
	// id is the stable widget id (its URL "<page>/api/<id>"); assigned by the page when empty.
	id string
	// height is the chart height in pixels.
	height int `dashica-gen:"client"`
	// width is the chart width in pixels. Zero value: fills the container width.
	width *int `dashica-gen:"client"`
	// marginLeft is the left margin in pixels. Zero value: Observable Plot's default.
	marginLeft *int `dashica-gen:"client"`
	// marginRight is the right margin in pixels. Zero value: Observable Plot's default.
	marginRight *int `dashica-gen:"client"`
	// marginBottom is the bottom margin in pixels. Zero value: Observable Plot's default.
	marginBottom *int `dashica-gen:"client"`
	// marginTop is the top margin in pixels. Zero value: Observable Plot's default.
	marginTop *int `dashica-gen:"client"`
	// color configures the color scale used for fill. Zero value: an ordinal
	// scale with the observable10 scheme, shown with a legend.
	color *color.ColorScale `dashica-gen:"client"`
}

func NewBarHorizontal(sqlq sql.SqlQueryable) *BarHorizontal {
	return &BarHorizontal{
		sql:    sqlq,
		height: 200,
	}
}

func (b *BarHorizontal) X(xField sql.SqlField) *BarHorizontal {
	cloned := *b
	cloned.x = xField
	return &cloned
}

func (b *BarHorizontal) Y(yField sql.SqlField) *BarHorizontal {
	cloned := *b
	cloned.y = yField
	return &cloned
}

func (b *BarHorizontal) Fill(fillField sql.SqlField) *BarHorizontal {
	cloned := *b
	cloned.fill = &fillField
	return &cloned
}

func (b *BarHorizontal) Title(title string) *BarHorizontal {
	cloned := *b
	cloned.title = title
	return &cloned
}

func (b *BarHorizontal) Id(id string) *BarHorizontal {
	cloned := *b
	cloned.id = id
	return &cloned
}

func (b *BarHorizontal) Height(height int) *BarHorizontal {
	cloned := *b
	cloned.height = height
	return &cloned
}

func (b *BarHorizontal) Width(width int) *BarHorizontal {
	cloned := *b
	cloned.width = &width
	return &cloned
}

func (b *BarHorizontal) MarginLeft(margin int) *BarHorizontal {
	cloned := *b
	cloned.marginLeft = &margin
	return &cloned
}

func (b *BarHorizontal) MarginRight(margin int) *BarHorizontal {
	cloned := *b
	cloned.marginRight = &margin
	return &cloned
}

func (b *BarHorizontal) MarginBottom(margin int) *BarHorizontal {
	cloned := *b
	cloned.marginBottom = &margin
	return &cloned
}

func (b *BarHorizontal) MarginTop(margin int) *BarHorizontal {
	cloned := *b
	cloned.marginTop = &margin
	return &cloned
}

func (b *BarHorizontal) Color(opts ...color.ColorScaleOption) *BarHorizontal {
	cloned := *b
	if cloned.color == nil {
		cloned.color = color.New()
	}
	cloned.color = cloned.color.With(opts...)
	return &cloned
}

func (b *BarHorizontal) AdjustQuery(opts ...sql.SqlBuilderOption) *BarHorizontal {
	cloned := *b
	cloned.sql = cloned.sql.With(opts...)
	return &cloned
}

func (b *BarHorizontal) Query() sql.SqlQueryable {
	query := b.sql.With(
		sql.PrependSelect(b.y),
		sql.GroupBy(b.y),
		sql.Select(b.x),
	)
	if b.fill != nil {
		query = query.With(
			sql.PrependSelect(*b.fill),
			sql.GroupBy(*b.fill),
		)
	}
	return query
}

func (b *BarHorizontal) explicitId() string { return b.id }
