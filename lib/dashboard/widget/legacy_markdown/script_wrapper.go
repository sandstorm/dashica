package legacy_markdown

import (
	"bytes"
	"fmt"
	"io"

	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	util2 "github.com/sandstorm/dashica/lib/util"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/renderer/html"
	"github.com/yuin/goldmark/util"
)

// ScriptWrapperRenderer wraps script tags with additional JavaScript
type ScriptWrapperRenderer struct {
	html.Config
	renderingContext rendering.DashboardContext
}

// RegisterFuncs registers the renderer for HTML blocks
func (r *ScriptWrapperRenderer) RegisterFuncs(reg renderer.NodeRendererFuncRegisterer) {
	reg.Register(ast.KindHTMLBlock, r.renderHTMLBlock)
	reg.Register(ast.KindRawHTML, r.renderRawHTML)
}

func (r *ScriptWrapperRenderer) renderHTMLBlock(w util.BufWriter, source []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
	if !entering {
		return ast.WalkContinue, nil
	}

	n := node.(*ast.HTMLBlock)
	if r.Unsafe {
		content := extractContent(n, source)
		if isScriptTag(content) {
			r.wrapScript(w, content)
		} else {
			w.Write(content)
		}
	}
	return ast.WalkContinue, nil
}

func (r *ScriptWrapperRenderer) renderRawHTML(w util.BufWriter, source []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
	if !entering {
		return ast.WalkContinue, nil
	}

	if r.Unsafe {
		n := node.(*ast.RawHTML)
		content := n.Segments.Value(source)
		if isScriptTag(content) {
			r.wrapScript(w, content)
		} else {
			w.Write(content)
		}
	}
	return ast.WalkContinue, nil
}

func (r *ScriptWrapperRenderer) wrapScript(w io.Writer, scriptContent []byte) {
	// Add your wrapper code here
	if bytes.HasPrefix(scriptContent, []byte("<script>")) {
		scriptContent = scriptContent[8:]
		w.Write([]byte("<script>\n"))

		w.Write([]byte("/* This script was wrapped by the Markdown renderer */\n"))
		w.Write([]byte(fmt.Sprintf("window.LegacyScriptWrapper(%s, async function({chart, visibility, clickhouse, filters}) {\n", util2.JsonEncode(r.renderingContext.CurrentHandlerUrl))))
		w.Write(scriptContent)
		w.Write([]byte("});\n"))

	} else {
		w.Write([]byte("<!-- SHOULD NEVER HAPPEN -->\n"))
		w.Write(scriptContent)
	}

	w.Write([]byte("</script>\n")) // Add the missing closing tag!

}

func isScriptTag(content []byte) bool {
	return bytes.Contains(bytes.ToLower(content), []byte("<script"))
}

func extractContent(n *ast.HTMLBlock, source []byte) []byte {
	var buf bytes.Buffer
	for i := 0; i < n.Lines().Len(); i++ {
		line := n.Lines().At(i)
		buf.Write(line.Value(source))
	}
	return buf.Bytes()
}

// NewScriptWrapperRenderer creates a new script wrapper renderer
func NewScriptWrapperRenderer(renderingContext rendering.DashboardContext, opts ...html.Option) renderer.NodeRenderer {
	r := &ScriptWrapperRenderer{
		renderingContext: renderingContext,
		Config:           html.NewConfig(),
	}
	for _, opt := range opts {
		opt.SetHTMLOption(&r.Config)
	}
	return r
}
