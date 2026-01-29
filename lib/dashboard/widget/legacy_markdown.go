package widget

import (
	"bytes"
	"fmt"
	"os"

	"github.com/a-h/templ"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/dashboard/widget/legacy_markdown"
	"github.com/sandstorm/dashica/lib/httpserver"
	"github.com/sandstorm/dashica/lib/util/handler_collector"
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer/html"
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

func (w *LegacyMarkdown) BuildComponents(renderingContext rendering.DashboardContext) (templ.Component, error) {
	contents, err := os.ReadFile(w.file)
	if err != nil {
		return nil, fmt.Errorf("reading file %s: %w", w.file, err)
	}

	var buf bytes.Buffer

	md := goldmark.New(
		goldmark.WithExtensions(extension.GFM, legacy_markdown.NewPlaceholderExtension(func(name string) (replacement string, found bool) {
			return fmt.Sprintf(`<div x-data="legacyInlinePlaceholder('%s')" class="not-prose"></div>`, name), true
		}, renderingContext)),
		goldmark.WithParserOptions(
			parser.WithAutoHeadingID(),
		),
		goldmark.WithRendererOptions(
			html.WithUnsafe(),
		),
	)

	if err := md.Convert(contents, &buf); err != nil {
		return nil, fmt.Errorf("converting markdown %s to HTML: %w", w.file, err)
	}

	return templ.Raw(`<div class="legacyMarkdown">` + buf.String() + `</div>`), nil
}

func (w *LegacyMarkdown) CollectHandlers(ctx rendering.DashboardContext, collector handler_collector.HandlerCollector) error {

	return collector.Handle("query", httpserver.ErrorHandler(httpserver.QueryHandler{
		ClickhouseClientManager: ctx.Deps.ClickhouseClientManager,
		Logger:                  ctx.Deps.Logger,
		FileSystem:              ctx.Deps.FileSystem,
	}))

}

var _ InteractiveWidget = (*LegacyMarkdown)(nil)
