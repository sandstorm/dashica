package widget

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/sandstorm/dashica/lib/dashboard/rendering"
)

func TestMarkdown_Content(t *testing.T) {
	tests := []struct {
		name     string
		content  string
		expected []string
	}{
		{
			name:    "Simple markdown",
			content: "# Hello World\n\nThis is a test.",
			expected: []string{
				"<h1",
				"Hello World",
				"<p>",
				"This is a test",
			},
		},
		{
			name:    "GFM table",
			content: "| Name | Age |\n|------|-----|\n| John | 30  |",
			expected: []string{
				"<table>",
				"<th>Name</th>",
				"<th>Age</th>",
				"<td>John</td>",
				"<td>30</td>",
			},
		},
		{
			name:    "GFM strikethrough",
			content: "This is ~~crossed out~~.",
			expected: []string{
				"<del>crossed out</del>",
			},
		},
		{
			name:    "Auto heading IDs",
			content: "## Installation\n\nSome content.",
			expected: []string{
				`id="installation"`,
			},
		},
		{
			name: "Code blocks with syntax highlighting",
			content: "```go\nfunc main() {}\n```",
			expected: []string{
				"<pre",
				"<code",
				"main", // The word "main" will be in the output even if styled
			},
		},
	}

	ctx := createTestContext()

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			widget := NewMarkdown().Content(tt.content)

			component, err := widget.BuildComponents(ctx)
			if err != nil {
				t.Fatalf("BuildComponents failed: %v", err)
			}

			// Render the component to a string
			var buf strings.Builder
			err = component.Render(context.Background(), &buf)
			if err != nil {
				t.Fatalf("Render failed: %v", err)
			}

			output := buf.String()

			// Check that all expected strings are present
			for _, exp := range tt.expected {
				if !strings.Contains(output, exp) {
					t.Errorf("Expected output to contain %q, but it was not found.\nOutput: %s", exp, output)
				}
			}
		})
	}
}

func TestMarkdown_Title(t *testing.T) {
	widget := NewMarkdown().
		Content("Some content").
		Title("Documentation")

	ctx := createTestContext()
	component, err := widget.BuildComponents(ctx)
	if err != nil {
		t.Fatalf("BuildComponents failed: %v", err)
	}

	var buf strings.Builder
	err = component.Render(context.Background(), &buf)
	if err != nil {
		t.Fatalf("Render failed: %v", err)
	}

	output := buf.String()

	if !strings.Contains(output, "Documentation") {
		t.Errorf("Expected title 'Documentation' in output, got: %s", output)
	}
}

func TestMarkdown_File(t *testing.T) {
	// Create a temporary markdown file
	tmpDir := t.TempDir()
	testFile := filepath.Join(tmpDir, "test.md")
	testContent := "# Test File\n\nThis is from a file."

	err := os.WriteFile(testFile, []byte(testContent), 0644)
	if err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	widget := NewMarkdown().File(testFile)

	ctx := createTestContext()
	component, err := widget.BuildComponents(ctx)
	if err != nil {
		t.Fatalf("BuildComponents failed: %v", err)
	}

	var buf strings.Builder
	err = component.Render(context.Background(), &buf)
	if err != nil {
		t.Fatalf("Render failed: %v", err)
	}

	output := buf.String()

	expectedStrings := []string{
		"<h1",
		"Test File",
		"This is from a file",
	}

	for _, exp := range expectedStrings {
		if !strings.Contains(output, exp) {
			t.Errorf("Expected output to contain %q, got: %s", exp, output)
		}
	}
}

func TestMarkdown_FileNotFound(t *testing.T) {
	widget := NewMarkdown().File("/nonexistent/file.md")

	ctx := createTestContext()
	_, err := widget.BuildComponents(ctx)
	if err == nil {
		t.Error("Expected error for nonexistent file, got nil")
	}

	if !strings.Contains(err.Error(), "reading markdown file") {
		t.Errorf("Expected error message about reading file, got: %v", err)
	}
}

func TestMarkdown_NoContentOrFile(t *testing.T) {
	widget := NewMarkdown()

	ctx := createTestContext()
	_, err := widget.BuildComponents(ctx)
	if err == nil {
		t.Error("Expected error when neither Content nor File is set, got nil")
	}

	if !strings.Contains(err.Error(), "requires either Content() or File()") {
		t.Errorf("Expected error message about requiring Content or File, got: %v", err)
	}
}

func TestMarkdown_Immutability(t *testing.T) {
	// Test that the fluent API returns new instances
	original := NewMarkdown()
	withContent := original.Content("test")
	withTitle := withContent.Title("Title")

	// Original should be unchanged
	if original.content != "" {
		t.Error("Original widget was mutated after Content() call")
	}

	// WithContent should have content but no title
	if withContent.content != "test" {
		t.Error("Content not set correctly")
	}
	if withContent.title != "" {
		t.Error("WithContent should not have a title")
	}

	// WithTitle should have both
	if withTitle.content != "test" {
		t.Error("Content lost after Title() call")
	}
	if withTitle.title != "Title" {
		t.Error("Title not set correctly")
	}
}

func TestMarkdown_HTMLUnsafe(t *testing.T) {
	// Test that raw HTML is rendered (goldmark WithUnsafe option)
	widget := NewMarkdown().Content("This is <strong>bold</strong> text.")

	ctx := createTestContext()
	component, err := widget.BuildComponents(ctx)
	if err != nil {
		t.Fatalf("BuildComponents failed: %v", err)
	}

	var buf strings.Builder
	err = component.Render(context.Background(), &buf)
	if err != nil {
		t.Fatalf("Render failed: %v", err)
	}

	output := buf.String()

	if !strings.Contains(output, "<strong>bold</strong>") {
		t.Error("Expected raw HTML to be rendered, but it was escaped or removed")
	}
}

func TestMarkdown_SyntaxHighlighting(t *testing.T) {
	tests := []struct {
		name     string
		content  string
		language string
	}{
		{
			name:     "Go code",
			content:  "```go\npackage main\n\nfunc test() {}\n```",
			language: "go",
		},
		{
			name:     "SQL code",
			content:  "```sql\nSELECT * FROM users WHERE id = 1;\n```",
			language: "sql",
		},
		{
			name:     "JavaScript code",
			content:  "```javascript\nconst x = 42;\nconsole.log(x);\n```",
			language: "javascript",
		},
		{
			name:     "Bash code",
			content:  "```bash\necho \"Hello World\"\n```",
			language: "bash",
		},
	}

	ctx := createTestContext()

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			widget := NewMarkdown().Content(tt.content)

			component, err := widget.BuildComponents(ctx)
			if err != nil {
				t.Fatalf("BuildComponents failed: %v", err)
			}

			var buf strings.Builder
			err = component.Render(context.Background(), &buf)
			if err != nil {
				t.Fatalf("Render failed: %v", err)
			}

			output := buf.String()

			// Verify that syntax highlighting is applied by checking for style attributes
			if !strings.Contains(output, "style=") {
				t.Errorf("Expected syntax highlighting (style attributes) in output for %s code", tt.language)
			}

			// Verify pre and code tags are present
			if !strings.Contains(output, "<pre") || !strings.Contains(output, "<code") {
				t.Error("Expected <pre> and <code> tags in output")
			}
		})
	}
}

// Helper function to create a minimal test context
func createTestContext() *rendering.DashboardContext {
	return &rendering.DashboardContext{
		// Add minimal fields needed for testing
		// Most widget tests won't need a full context
	}
}
