package widget

import (
	"bytes"
	"fmt"
	"net/http"
	"os"

	"github.com/a-h/templ"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/dashboard/widget/legacy_markdown"
	"github.com/sandstorm/dashica/lib/util/handler_collector"
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/renderer/html"
	"github.com/yuin/goldmark/util"
)

type LegacyMarkdown struct {
	file string
}

func NewLegacyMarkdown() *LegacyMarkdown {
	return &LegacyMarkdown{}
}

func (w *LegacyMarkdown) File(path string) *LegacyMarkdown {
	cloned := *w
	cloned.file = path
	return &cloned
}

func (w *LegacyMarkdown) BuildComponents(renderingContext rendering.RenderingContext) (templ.Component, error) {
	contents, err := os.ReadFile(w.file)
	if err != nil {
		return nil, fmt.Errorf("reading file %s: %w", w.file, err)
	}

	var buf bytes.Buffer

	md := goldmark.New(
		goldmark.WithExtensions(extension.GFM),
		goldmark.WithParserOptions(
			parser.WithAutoHeadingID(),
		),
		goldmark.WithRendererOptions(
			html.WithUnsafe(),
		),
		goldmark.WithRenderer(
			renderer.NewRenderer(
				renderer.WithNodeRenderers(
					util.Prioritized(legacy_markdown.NewScriptWrapperRenderer(renderingContext, html.WithUnsafe()), 100),
				),
			),
		),
	)

	if err := md.Convert(contents, &buf); err != nil {
		return nil, fmt.Errorf("converting markdown %s to HTML: %w", w.file, err)
	}

	return templ.Raw(buf.String()), nil
}

func (w *LegacyMarkdown) CollectHandlers(collector handler_collector.HandlerCollector) error {
	return collector.Handle("query", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		println("LEGACY QUERY CALLED")
	}))

}

var _ InteractiveWidget = (*LegacyMarkdown)(nil)
