package widget

import (
	"testing"
)

func TestCheckboxGroup_Immutability(t *testing.T) {
	original := NewCheckboxGroup("n", "L", []string{"a", "b"})
	_ = original.Default([]string{"a"})
	if len(original.defaults) != 0 {
		t.Errorf("original mutated by Default(): %v", original.defaults)
	}
}
