package widget

import (
	"bytes"
	"fmt"
	"os"

	"github.com/a-h/templ"
	"github.com/sandstorm/dashica/lib/components/widget_component"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer/html"
	highlighting "github.com/yuin/goldmark-highlighting/v2"
)

// Markdown is a simple widget for rendering markdown content without any legacy features.
// It is intended for documentation and static content, not for Observable-style dashboards.
type Markdown struct {
	content string
	file    string
	title   string
}

// NewMarkdown creates a new Markdown widget.
func NewMarkdown() *Markdown {
	return &Markdown{}
}

// Content sets the markdown content to render inline.
func (m *Markdown) Content(markdown string) *Markdown {
	cloned := *m
	cloned.content = markdown
	return &cloned
}

// File sets the path to a markdown file to load and render.
func (m *Markdown) File(path string) *Markdown {
	cloned := *m
	cloned.file = path
	return &cloned
}

// Title sets an optional title for the markdown widget.
func (m *Markdown) Title(title string) *Markdown {
	cloned := *m
	cloned.title = title
	return &cloned
}

// BuildComponents implements the WidgetDefinition interface.
func (m *Markdown) BuildComponents(ctx *rendering.DashboardContext) (templ.Component, error) {
	var markdownSource []byte
	var err error

	// Determine the markdown source: file or inline content
	if m.file != "" {
		markdownSource, err = os.ReadFile(m.file)
		if err != nil {
			return nil, fmt.Errorf("reading markdown file %s: %w", m.file, err)
		}
	} else if m.content != "" {
		markdownSource = []byte(m.content)
	} else {
		return nil, fmt.Errorf("markdown widget requires either Content() or File()")
	}

	// Convert markdown to HTML
	var buf bytes.Buffer

	md := goldmark.New(
		goldmark.WithExtensions(
			extension.GFM,
			highlighting.NewHighlighting(
				highlighting.WithStyle("dracula"),
				highlighting.WithFormatOptions(),
			),
		),
		goldmark.WithParserOptions(
			parser.WithAutoHeadingID(),
		),
		goldmark.WithRendererOptions(
			html.WithUnsafe(),
		),
	)

	if err := md.Convert(markdownSource, &buf); err != nil {
		return nil, fmt.Errorf("converting markdown to HTML: %w", err)
	}

	return widget_component.Markdown(m.title, buf.String()), nil
}

var _ WidgetDefinition = (*Markdown)(nil)
