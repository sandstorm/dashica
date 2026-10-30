package widget

import (
	"strings"
	"testing"
)

func TestTextInput_Immutability(t *testing.T) {
	original := NewTextInput("p", "P")
	_ = original.Placeholder("hello")
	if original.placeholder != "" {
		t.Errorf("original mutated by Placeholder")
	}
	_ = original.PrependCaret()
	if original.prependCaret {
		t.Errorf("original mutated by PrependCaret")
	}
}

func mustContain(t *testing.T, haystack, needle string) {
	t.Helper()
	if !strings.Contains(haystack, needle) {
		t.Errorf("expected output to contain %q\n--- output ---\n%s", needle, haystack)
	}
}
