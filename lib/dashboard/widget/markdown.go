package widget

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"io/fs"
	"net/http"
	"path"
	"regexp"
	"strings"

	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/yuin/goldmark"
	highlighting "github.com/yuin/goldmark-highlighting/v2"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/renderer/html"
)

// Markdown is a widget that renders markdown content, for documentation and static content.
type Markdown struct {
	// content is the markdown source rendered inline, set via Content().
	content string
	// file is the project-relative path to a markdown file to load and
	// render, set via File(). Ignored for untrusted content.
	file string
	// title is the optional title shown above the rendered markdown.
	title string `dashica-gen:"client"`
	// assets is a runtime filesystem handle, which dashica-gen skips.
	assets fs.FS `dashica-gen:"skip"`
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

// Assets attaches a filesystem (typically a //go:embed embed.FS) used to resolve relative
// image references in the rendered markdown. Each <img src="path"> whose path resolves
// inside fsys is replaced with a data:<mime>;base64,<...> URI so the document is
// self-contained. Absolute URLs (http:, https:, //, data:) and unresolvable paths are
// left untouched.
func (m *Markdown) Assets(fsys fs.FS) *Markdown {
	cloned := *m
	cloned.assets = fsys
	return &cloned
}

// markdownComputed is what the server computes for a markdown when the page is mounted.
type markdownComputed struct {
	// html is content or file rendered to HTML.
	html string
}

// computeProps renders the markdown; an untrusted dashboard's File() is refused.
func (m *Markdown) computeProps(ctx *rendering.DashboardContext) (markdownComputed, error) {
	html, err := m.renderHTML(ctx.Deps.FileSystem, ctx.UntrustedContent)
	return markdownComputed{html: html}, err
}

// renderHTML is the markdown (its content, else its file from the project filesystem `fsys`) as HTML.
func (m *Markdown) renderHTML(fsys fs.ReadFileFS, untrusted bool) (string, error) {
	var markdownSource []byte
	var err error

	// Determine the markdown source: file or inline content
	if m.file != "" {
		// File() reads from the project filesystem, never the host filesystem, and
		// is forbidden entirely for untrusted content. Markdown.file is serialized
		// and settable from author-controlled widget JSON; reading it with
		// os.ReadFile on the host FS would be an arbitrary-file-read primitive once
		// Explore renders untrusted widgets (e.g. {"file":"/etc/passwd"}).
		if untrusted {
			return "", fmt.Errorf("markdown: File() is not permitted for untrusted content; use inline Content()")
		}
		if fsys == nil {
			return "", fmt.Errorf("markdown: File(%q) requires a project filesystem", m.file)
		}
		cleaned := path.Clean(strings.TrimPrefix(m.file, "./"))
		if !fs.ValidPath(cleaned) {
			return "", fmt.Errorf("markdown: File(%q) is not a valid project-relative path", m.file)
		}
		markdownSource, err = fs.ReadFile(fsys, cleaned)
		if err != nil {
			return "", fmt.Errorf("reading markdown file %s: %w", cleaned, err)
		}
	} else if m.content != "" {
		markdownSource = []byte(m.content)
	} else {
		return "", fmt.Errorf("markdown widget requires either Content() or File()")
	}

	// Convert markdown to HTML.
	var buf bytes.Buffer

	// Raw HTML in the markdown source passes through only for TRUSTED (compiled-in)
	// content. When the widget is rendered from an untrusted author — a dashboard
	// built or stored via Explore — html.WithUnsafe() is omitted, so goldmark
	// escapes embedded <script>/<iframe>/on*-handlers instead of emitting them
	// (the client inserts the rendered HTML as is, from the props' `html`). GFM
	// tables and syntax highlighting are renderer output, unaffected either way.
	rendererOpts := []renderer.Option{}
	if !untrusted {
		rendererOpts = append(rendererOpts, html.WithUnsafe())
	}

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
		goldmark.WithRendererOptions(rendererOpts...),
	)

	if err := md.Convert(markdownSource, &buf); err != nil {
		return "", fmt.Errorf("converting markdown to HTML: %w", err)
	}

	htmlOut := buf.String()
	if m.assets != nil {
		htmlOut = inlineAssetImages(htmlOut, m.assets)
	}
	return htmlOut, nil
}

var imgSrcPattern = regexp.MustCompile(`(<img\b[^>]*\bsrc=")([^"]+)(")`)

// inlineAssetImages rewrites <img src="..."> tags whose src is a relative path resolvable
// inside fsys, replacing the src attribute with a base64-encoded data: URI.
func inlineAssetImages(htmlSrc string, fsys fs.FS) string {
	return imgSrcPattern.ReplaceAllStringFunc(htmlSrc, func(match string) string {
		groups := imgSrcPattern.FindStringSubmatch(match)
		prefix, src, suffix := groups[1], groups[2], groups[3]
		if isExternalURL(src) {
			return match
		}
		cleaned := path.Clean(strings.TrimPrefix(src, "./"))
		data, err := fs.ReadFile(fsys, cleaned)
		if err != nil {
			return match
		}
		mime := mimeForExtension(path.Ext(cleaned))
		if mime == "" {
			mime = http.DetectContentType(data)
		}
		encoded := base64.StdEncoding.EncodeToString(data)
		return prefix + "data:" + mime + ";base64," + encoded + suffix
	})
}

func isExternalURL(s string) bool {
	switch {
	case strings.HasPrefix(s, "http://"),
		strings.HasPrefix(s, "https://"),
		strings.HasPrefix(s, "//"),
		strings.HasPrefix(s, "data:"),
		strings.HasPrefix(s, "/"):
		return true
	}
	return false
}

func mimeForExtension(ext string) string {
	switch strings.ToLower(ext) {
	case ".svg":
		return "image/svg+xml"
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	}
	return ""
}
