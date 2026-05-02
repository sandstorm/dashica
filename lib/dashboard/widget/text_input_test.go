package widget

import (
	"strings"
	"testing"
)

func TestTextInput_RendersCSPFriendlyMarkup(t *testing.T) {
	t.Run("plain", func(t *testing.T) {
		w := NewTextInput("request_path", "Request Path").
			Placeholder(`for only "/" type "/$"`)
		out := renderComponent(t, w)

		mustContain(t, out, `x-data="textInput"`)
		mustContain(t, out, `data-name="request_path"`)
		mustContain(t, out, `data-prepend-caret="false"`)
		mustContain(t, out, `:value="displayValue()"`)
		mustContain(t, out, `@input="write($event)"`)
		// Label is shown
		mustContain(t, out, `Request Path`)
		// Quotes in placeholder are HTML-escaped (renders as &#34; in attr context)
		mustContain(t, out, `placeholder="for only`)
	})

	t.Run("with prepend caret", func(t *testing.T) {
		w := NewTextInput("request_path", "Request Path").PrependCaret()
		out := renderComponent(t, w)
		mustContain(t, out, `data-prepend-caret="true"`)
	})

	t.Run("immutability", func(t *testing.T) {
		original := NewTextInput("p", "P")
		_ = original.Placeholder("hello")
		if original.placeholder != "" {
			t.Errorf("original mutated by Placeholder")
		}
		_ = original.PrependCaret()
		if original.prependCaret {
			t.Errorf("original mutated by PrependCaret")
		}
	})

	t.Run("escapes attributes", func(t *testing.T) {
		w := NewTextInput(`evil"name`, `<Label>`).Placeholder(`p"holder`)
		out := renderComponent(t, w)
		// Make sure raw injected double-quotes don't break out of attributes.
		if strings.Contains(out, `data-name="evil"name"`) {
			t.Errorf("name attribute not escaped: %s", out)
		}
		// Label HTML escaped
		if strings.Contains(out, `<Label>`) {
			t.Errorf("label not escaped: %s", out)
		}
	})
}

func mustContain(t *testing.T, haystack, needle string) {
	t.Helper()
	if !strings.Contains(haystack, needle) {
		t.Errorf("expected output to contain %q\n--- output ---\n%s", needle, haystack)
	}
}
