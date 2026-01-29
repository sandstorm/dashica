package legacy_markdown

import (
	"bytes"
	"fmt"
	"io"
	"regexp"

	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	util2 "github.com/sandstorm/dashica/lib/util"
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

// PlaceholderNode represents a ${...} placeholder
type PlaceholderNode struct {
	ast.BaseInline
	Name []byte
}

var KindPlaceholder = ast.NewNodeKind("Placeholder")

func (n *PlaceholderNode) Kind() ast.NodeKind {
	return KindPlaceholder
}

func (n *PlaceholderNode) Dump(source []byte, level int) {
	ast.DumpHelper(n, source, level, map[string]string{
		"Name": string(n.Name),
	}, nil)
}

func NewPlaceholderNode(name []byte) *PlaceholderNode {
	return &PlaceholderNode{Name: name}
}

// PlaceholderReplacer is a function that takes a placeholder name and returns its replacement
type PlaceholderReplacer func(name string) (replacement string, found bool)

// Parser
type placeholderParser struct{}

func (s *placeholderParser) Trigger() []byte {
	return []byte{'$'}
}

func (s *placeholderParser) Parse(parent ast.Node, block text.Reader, pc parser.Context) ast.Node {
	line, _ := block.PeekLine()
	if len(line) < 3 || line[0] != '$' || line[1] != '{' {
		return nil
	}

	closePos := -1
	for i := 2; i < len(line); i++ {
		if line[i] == '}' {
			closePos = i
			break
		}
	}
	if closePos == -1 {
		return nil
	}

	name := line[2:closePos]
	block.Advance(closePos + 1)
	return NewPlaceholderNode(name)
}

func (s *placeholderParser) CloseBlock(parent ast.Node, pc parser.Context) {}

// Combined Renderer - handles both placeholders and script wrapping
type combinedRenderer struct {
	replacer         PlaceholderReplacer
	renderingContext rendering.DashboardContext
	pattern          *regexp.Regexp
	wrapJsBlocks     bool
}

func (r *combinedRenderer) RegisterFuncs(reg renderer.NodeRendererFuncRegisterer) {
	reg.Register(KindPlaceholder, r.renderPlaceholder)
	reg.Register(ast.KindRawHTML, r.renderRawHTML)
	reg.Register(ast.KindHTMLBlock, r.renderHTMLBlock)

	// Register for fenced code blocks to wrap ```js blocks
	if r.wrapJsBlocks {
		reg.Register(ast.KindFencedCodeBlock, r.renderFencedCodeBlock)
	}
}

func (r *combinedRenderer) renderPlaceholder(w util.BufWriter, source []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
	if !entering {
		return ast.WalkContinue, nil
	}
	n := node.(*PlaceholderNode)
	name := string(n.Name)

	if replacement, found := r.replacer(name); found {
		w.WriteString(replacement)
	} else {
		w.WriteString("${" + name + "}")
	}
	return ast.WalkContinue, nil
}

func (r *combinedRenderer) renderRawHTML(w util.BufWriter, source []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
	if !entering {
		return ast.WalkContinue, nil
	}

	n := node.(*ast.RawHTML)
	var content []byte
	for i := 0; i < n.Segments.Len(); i++ {
		at := n.Segments.At(i)
		content = append(content, at.Value(source)...)
	}

	// Replace placeholders
	result := r.replaceContent(content)
	w.WriteString(result)
	return ast.WalkContinue, nil
}

func (r *combinedRenderer) renderHTMLBlock(w util.BufWriter, source []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
	if !entering {
		return ast.WalkContinue, nil
	}

	n := node.(*ast.HTMLBlock)

	// Collect all lines
	var contentBuf bytes.Buffer
	lines := n.Lines()

	for i := 0; i < lines.Len(); i++ {
		line := lines.At(i)
		lineContent := line.Value(source)
		contentBuf.Write(lineContent)
	}

	// Add closure line if present
	if n.HasClosure() {
		closure := n.ClosureLine
		closureContent := closure.Value(source)
		contentBuf.Write(closureContent)
	}

	content := contentBuf.Bytes()

	// Replace placeholders
	result := r.replaceContent(content)
	w.WriteString(result)
	return ast.WalkContinue, nil
}

func (r *combinedRenderer) renderFencedCodeBlock(w util.BufWriter, source []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
	if !entering {
		return ast.WalkContinue, nil
	}

	n := node.(*ast.FencedCodeBlock)

	// Get the language identifier
	language := n.Language(source)

	// Check if this is a JavaScript code block
	if !isJavaScriptLanguage(language) {
		// Not a JS block, render normally
		return r.renderDefaultFencedCodeBlock(w, source, n)
	}

	// Extract the code content
	var codeBuf bytes.Buffer
	lines := n.Lines()
	for i := 0; i < lines.Len(); i++ {
		line := lines.At(i)
		codeBuf.Write(line.Value(source))
	}

	codeContent := codeBuf.Bytes()

	// Replace placeholders in the code
	processedCode := r.replaceContent(codeContent)

	// Wrap in script tag with LegacyScriptWrapper
	r.wrapJavaScriptCode(w, []byte(processedCode))

	return ast.WalkContinue, nil
}

func (r *combinedRenderer) renderDefaultFencedCodeBlock(w util.BufWriter, source []byte, n *ast.FencedCodeBlock) (ast.WalkStatus, error) {
	// Default rendering for non-JS code blocks
	language := n.Language(source)

	w.WriteString("<pre><code")
	if len(language) > 0 {
		w.WriteString(` class="language-`)
		w.Write(language)
		w.WriteString(`"`)
	}
	w.WriteString(">")

	lines := n.Lines()
	for i := 0; i < lines.Len(); i++ {
		line := lines.At(i)
		w.Write(line.Value(source))
	}

	w.WriteString("</code></pre>\n")

	return ast.WalkContinue, nil
}

func (r *combinedRenderer) wrapJavaScriptCode(w io.Writer, jsCode []byte) {
	// Replace "const [something] = chart." with "exports.[something] = chart."
	re := regexp.MustCompile(`const\s+(\w+)\s*=\s*chart\.`)
	modified := re.ReplaceAll(jsCode, []byte("exports.$1 = chart."))

	// Write wrapped script
	w.Write([]byte("<script>\n"))
	w.Write([]byte("/* JavaScript code block wrapped by Markdown renderer */\n"))
	w.Write([]byte(fmt.Sprintf("window.LegacyScriptWrapper(%s, async function({chart, visibility, clickhouse, filters, viewOptions, invalidation, exports}) {\n",
		util2.JsonEncode(r.renderingContext.CurrentHandlerUrl))))
	w.Write(modified)
	w.Write([]byte("\n});\n"))
	w.Write([]byte("</script>\n"))
}

func isJavaScriptLanguage(lang []byte) bool {
	if len(lang) == 0 {
		return false
	}

	langStr := string(bytes.ToLower(lang))
	return langStr == "js" || langStr == "javascript"
}

// Helper function to replace placeholders in content
func (r *combinedRenderer) replaceContent(content []byte) string {
	return r.pattern.ReplaceAllStringFunc(string(content), func(match string) string {
		name := match[2 : len(match)-1]
		if replacement, found := r.replacer(name); found {
			return replacement
		}
		return match
	})
}

// Extension
type PlaceholderExtension struct {
	Replacer         PlaceholderReplacer
	RenderingContext rendering.DashboardContext
	WrapJsBlocks     bool
}

// NewPlaceholderExtension creates a new extension with a callback function
func NewPlaceholderExtension(replacer PlaceholderReplacer, renderingContext rendering.DashboardContext) *PlaceholderExtension {
	return &PlaceholderExtension{
		Replacer:         replacer,
		RenderingContext: renderingContext,
		WrapJsBlocks:     true,
	}
}

// NewPlaceholderExtensionWithMap creates a new extension with a static map (convenience wrapper)
func NewPlaceholderExtensionWithMap(replacements map[string]string, renderingContext rendering.DashboardContext) *PlaceholderExtension {
	return &PlaceholderExtension{
		Replacer: func(name string) (string, bool) {
			replacement, found := replacements[name]
			return replacement, found
		},
		RenderingContext: renderingContext,
		WrapJsBlocks:     true,
	}
}

// WithoutJsWrapping disables JavaScript code block wrapping for this extension
func (e *PlaceholderExtension) WithoutJsWrapping() *PlaceholderExtension {
	e.WrapJsBlocks = false
	return e
}

func (e *PlaceholderExtension) Extend(m goldmark.Markdown) {
	m.Parser().AddOptions(
		parser.WithInlineParsers(
			util.Prioritized(&placeholderParser{}, 500),
		),
	)

	m.Renderer().AddOptions(
		renderer.WithNodeRenderers(
			util.Prioritized(&combinedRenderer{
				replacer:         e.Replacer,
				renderingContext: e.RenderingContext,
				pattern:          regexp.MustCompile(`\$\{([^}]+)\}`),
				wrapJsBlocks:     e.WrapJsBlocks,
			}, 0),
		),
	)
}
