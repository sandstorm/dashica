package legacy_markdown

import (
	"bytes"
	"fmt"
	"strings"
	"testing"

	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/renderer/html"
)

// Simple test cases
func TestPlaceholderParser(t *testing.T) {
	replacements := map[string]string{
		"test": "<div>REPLACED</div>",
	}

	md := goldmark.New(
		goldmark.WithExtensions(
			NewPlaceholderExtension(func(name string) (replacement string, found bool) {
				val, found := replacements[name]
				return val, found
			}, rendering.DashboardContext{}),
		),
		goldmark.WithRendererOptions(
			html.WithUnsafe(),
		),
	)

	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "Simple placeholder in text",
			input:    "Hello ${test} world",
			expected: "REPLACED",
		},
		{
			name:     "Placeholder alone",
			input:    "${test}",
			expected: "REPLACED",
		},
		{
			name:     "Placeholder in paragraph",
			input:    "This is a test ${test} here.",
			expected: "REPLACED",
		},
		{
			name:     "Placeholder in HTML",
			input:    "<div>${test}</div>",
			expected: "REPLACED",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fmt.Printf("\n=== Running test: %s ===\n", tt.name)
			fmt.Printf("Input: %q\n", tt.input)

			var buf bytes.Buffer
			if err := md.Convert([]byte(tt.input), &buf); err != nil {
				t.Fatalf("Convert failed: %v", err)
			}

			output := buf.String()
			fmt.Printf("Output: %q\n", output)

			if !bytes.Contains([]byte(output), []byte(tt.expected)) {
				t.Errorf("Expected output to contain %q, got %q", tt.expected, output)
			}
		})
	}
}

// Script tag tests
func TestScriptTags(t *testing.T) {
	replacements := map[string]string{
		"chartData": `{"x": [1,2,3], "y": [4,5,6]}`,
		"apiKey":    "test-api-key-123",
	}

	md := goldmark.New(
		goldmark.WithExtensions(
			NewPlaceholderExtension(func(name string) (replacement string, found bool) {
				val, found := replacements[name]
				return val, found
			}, rendering.DashboardContext{}),
		),
		goldmark.WithRendererOptions(
			html.WithUnsafe(),
		),
	)

	tests := []struct {
		name             string
		input            string
		shouldContain    []string
		shouldNotContain []string
	}{
		{
			name: "Simple script tag with placeholder",
			input: `<script>
var data = ${chartData};
console.log(data);
</script>`,
			shouldContain: []string{
				"<script>",
				"</script>",
				`{"x": [1,2,3], "y": [4,5,6]}`,
				"console.log",
			},
			shouldNotContain: []string{
				"${chartData}",
			},
		},
		{
			name: "Script tag with multiple placeholders",
			input: `<script>
const API_KEY = "${apiKey}";
const data = ${chartData};
fetch('/api', { headers: { 'X-API-Key': API_KEY } });
</script>`,
			shouldContain: []string{
				"<script>",
				"</script>",
				"test-api-key-123",
				`{"x": [1,2,3], "y": [4,5,6]}`,
				"fetch",
			},
			shouldNotContain: []string{
				"${apiKey}",
				"${chartData}",
			},
		},
		{
			name:  "Inline script tag",
			input: `<script>var x = ${chartData};</script>`,
			shouldContain: []string{
				"<script>",
				"</script>",
				`{"x": [1,2,3], "y": [4,5,6]}`,
			},
			shouldNotContain: []string{
				"${chartData}",
			},
		},
		{
			name: "Script tag with type attribute",
			input: `<script type="application/json">
${chartData}
</script>`,
			shouldContain: []string{
				`<script type="application/json">`,
				"</script>",
				`{"x": [1,2,3], "y": [4,5,6]}`,
			},
			shouldNotContain: []string{
				"${chartData}",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fmt.Printf("\n=== Script Test: %s ===\n", tt.name)
			fmt.Printf("Input:\n%s\n\n", tt.input)

			var buf bytes.Buffer
			if err := md.Convert([]byte(tt.input), &buf); err != nil {
				t.Fatalf("Convert failed: %v", err)
			}

			output := buf.String()
			fmt.Printf("Output:\n%s\n\n", output)

			for _, expected := range tt.shouldContain {
				if !strings.Contains(output, expected) {
					t.Errorf("Expected output to contain %q", expected)
				}
			}

			for _, notExpected := range tt.shouldNotContain {
				if strings.Contains(output, notExpected) {
					t.Errorf("Expected output to NOT contain %q", notExpected)
				}
			}
		})
	}
}

// Multiple blocks test
func TestMultipleBlocks(t *testing.T) {
	replacements := map[string]string{
		"chart1": `<canvas id="chart-1"></canvas>`,
		"chart2": `<canvas id="chart-2"></canvas>`,
		"chart3": `<canvas id="chart-3"></canvas>`,
		"data1":  `{"values": [1,2,3]}`,
		"data2":  `{"values": [4,5,6]}`,
	}

	md := goldmark.New(
		goldmark.WithExtensions(
			NewPlaceholderExtension(func(name string) (replacement string, found bool) {
				val, found := replacements[name]
				return val, found
			}, rendering.DashboardContext{}),
		),
		goldmark.WithRendererOptions(
			html.WithUnsafe(),
		),
	)

	tests := []struct {
		name             string
		input            string
		shouldContain    []string
		shouldNotContain []string
	}{
		{
			name: "Multiple div blocks",
			input: `<div class="chart-container">
  ${chart1}
</div>

<div class="chart-container">
  ${chart2}
</div>

<div class="chart-container">
  ${chart3}
</div>`,
			shouldContain: []string{
				`<canvas id="chart-1"></canvas>`,
				`<canvas id="chart-2"></canvas>`,
				`<canvas id="chart-3"></canvas>`,
				`class="chart-container"`,
			},
			shouldNotContain: []string{
				"${chart1}",
				"${chart2}",
				"${chart3}",
			},
		},
		{
			name: "Nested HTML with placeholders",
			input: `<div class="outer">
  <div class="inner">
    ${chart1}
  </div>
  <div class="inner">
    ${chart2}
  </div>
</div>`,
			shouldContain: []string{
				`<canvas id="chart-1"></canvas>`,
				`<canvas id="chart-2"></canvas>`,
				`class="outer"`,
				`class="inner"`,
			},
			shouldNotContain: []string{
				"${chart1}",
				"${chart2}",
			},
		},
		{
			name: "Mixed script and div blocks",
			input: `<div>
  ${chart1}
</div>

<script>
var data = ${data1};
</script>

<div>
  ${chart2}
</div>

<script>
var moreData = ${data2};
</script>`,
			shouldContain: []string{
				`<canvas id="chart-1"></canvas>`,
				`<canvas id="chart-2"></canvas>`,
				`{"values": [1,2,3]}`,
				`{"values": [4,5,6]}`,
				"</script>",
			},
			shouldNotContain: []string{
				"${chart1}",
				"${chart2}",
				"${data1}",
				"${data2}",
			},
		},
		{
			name: "HTML blocks separated by markdown",
			input: `<div>${chart1}</div>

# Some Markdown Header

Some paragraph text.

<div>${chart2}</div>

Another paragraph.

<script>
var x = ${data1};
</script>`,
			shouldContain: []string{
				`<canvas id="chart-1"></canvas>`,
				`<canvas id="chart-2"></canvas>`,
				`{"values": [1,2,3]}`,
				"<h1>Some Markdown Header</h1>",
				"<p>Some paragraph text.</p>",
				"<p>Another paragraph.</p>",
				"</script>",
			},
			shouldNotContain: []string{
				"${chart1}",
				"${chart2}",
				"${data1}",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fmt.Printf("\n=== Multiple Blocks Test: %s ===\n", tt.name)
			fmt.Printf("Input:\n%s\n\n", tt.input)

			var buf bytes.Buffer
			if err := md.Convert([]byte(tt.input), &buf); err != nil {
				t.Fatalf("Convert failed: %v", err)
			}

			output := buf.String()
			fmt.Printf("Output:\n%s\n\n", output)

			for _, expected := range tt.shouldContain {
				if !strings.Contains(output, expected) {
					t.Errorf("Expected output to contain %q", expected)
				}
			}

			for _, notExpected := range tt.shouldNotContain {
				if strings.Contains(output, notExpected) {
					t.Errorf("Expected output to NOT contain %q", notExpected)
				}
			}
		})
	}
}

// Real-world dashboard example
func TestRealWorldDashboard(t *testing.T) {
	replacements := map[string]string{
		"logVolumeSystemlog":   `<canvas id="log-volume-systemlog"></canvas>`,
		"logVolumeWithoutInfo": `<canvas id="log-volume-without-info"></canvas>`,
		"eventDatasetCounts":   `<canvas id="event-dataset-counts"></canvas>`,
		"chartConfig":          `{"responsive": true, "maintainAspectRatio": false}`,
	}

	md := goldmark.New(
		goldmark.WithExtensions(
			NewPlaceholderExtension(func(name string) (replacement string, found bool) {
				val, found := replacements[name]
				return val, found
			}, rendering.DashboardContext{}),
		),
		goldmark.WithRendererOptions(
			html.WithUnsafe(),
		),
	)

	input := `# System Dashboard

<div class="grid grid-cols-2">
  <div class="card">
    ${logVolumeSystemlog}
    ${logVolumeWithoutInfo}
  </div>
  <div class="card">
    ${eventDatasetCounts}
  </div>
</div>

<script>
const config = ${chartConfig};
initCharts(config);
</script>`

	var buf bytes.Buffer
	if err := md.Convert([]byte(input), &buf); err != nil {
		t.Fatalf("Convert failed: %v", err)
	}

	output := buf.String()
	fmt.Printf("\n=== Real World Dashboard ===\n")
	fmt.Printf("Input:\n%s\n\n", input)
	fmt.Printf("Output:\n%s\n\n", output)

	// Verify all placeholders replaced
	shouldContain := []string{
		`<canvas id="log-volume-systemlog"></canvas>`,
		`<canvas id="log-volume-without-info"></canvas>`,
		`<canvas id="event-dataset-counts"></canvas>`,
		`{"responsive": true, "maintainAspectRatio": false}`,
		`class="grid grid-cols-2"`,
		`class="card"`,
		"<h1>System Dashboard</h1>",
		"<script>",
		"</script>",
		"initCharts",
	}

	shouldNotContain := []string{
		"${logVolumeSystemlog}",
		"${logVolumeWithoutInfo}",
		"${eventDatasetCounts}",
		"${chartConfig}",
	}

	for _, expected := range shouldContain {
		if !strings.Contains(output, expected) {
			t.Errorf("Expected output to contain %q", expected)
		}
	}

	for _, notExpected := range shouldNotContain {
		if strings.Contains(output, notExpected) {
			t.Errorf("Expected output to NOT contain %q", notExpected)
		}
	}
}

// Edge cases
func TestEdgeCases(t *testing.T) {
	replacements := map[string]string{
		"test":  "REPLACED",
		"empty": "",
	}

	md := goldmark.New(
		goldmark.WithExtensions(
			NewPlaceholderExtension(func(name string) (replacement string, found bool) {
				val, found := replacements[name]
				return val, found
			}, rendering.DashboardContext{}),
		),
		goldmark.WithRendererOptions(
			html.WithUnsafe(),
		),
	)

	tests := []struct {
		name             string
		input            string
		shouldContain    []string
		shouldNotContain []string
	}{
		{
			name:  "Incomplete placeholder - no closing brace",
			input: `<div>${test without closing</div>`,
			shouldContain: []string{
				"<div>",
				"</div>",
				"${test without closing",
			},
			shouldNotContain: []string{
				"REPLACED",
			},
		},
		{
			name:  "Multiple placeholders on same line",
			input: `<div>${test} and ${test} again</div>`,
			shouldContain: []string{
				"REPLACED and REPLACED again",
			},
			shouldNotContain: []string{
				"${test}",
			},
		},
		{
			name:  "Placeholder with no replacement",
			input: `<div>${unknown}</div>`,
			shouldContain: []string{
				"${unknown}",
			},
			shouldNotContain: []string{
				"REPLACED",
			},
		},
		{
			name:  "Empty replacement",
			input: `<div>before ${empty} after</div>`,
			shouldContain: []string{
				"before  after",
			},
			shouldNotContain: []string{
				"${empty}",
			},
		},
		{
			name:  "Placeholder in HTML attribute",
			input: `<div data-value="${test}">Content</div>`,
			shouldContain: []string{
				`data-value="REPLACED"`,
			},
			shouldNotContain: []string{
				"${test}",
			},
		},
		{
			name: "Placeholder in style tag",
			input: `<style>
.chart { background: url(${test}); }
</style>`,
			shouldContain: []string{
				"<style>",
				"</style>",
				"background: url(REPLACED)",
			},
			shouldNotContain: []string{
				"${test}",
			},
		},
		{
			name:  "Self-closing tag with placeholder",
			input: `<img src="${test}" />`,
			shouldContain: []string{
				`src="REPLACED"`,
			},
			shouldNotContain: []string{
				"${test}",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fmt.Printf("\n=== Edge Case: %s ===\n", tt.name)
			fmt.Printf("Input: %q\n", tt.input)

			var buf bytes.Buffer
			if err := md.Convert([]byte(tt.input), &buf); err != nil {
				t.Fatalf("Convert failed: %v", err)
			}

			output := buf.String()
			fmt.Printf("Output: %q\n\n", output)

			for _, expected := range tt.shouldContain {
				if !strings.Contains(output, expected) {
					t.Errorf("Expected output to contain %q", expected)
				}
			}

			for _, notExpected := range tt.shouldNotContain {
				if strings.Contains(output, notExpected) {
					t.Errorf("Expected output to NOT contain %q", notExpected)
				}
			}
		})
	}
}
