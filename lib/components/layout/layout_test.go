package layout

import (
	"testing"
)

func TestBuiltinLayouts_Registered(t *testing.T) {
	for _, want := range []Layout{DefaultPage, DocsPage} {
		got, ok := ByName(want.Name)
		if !ok {
			t.Fatalf("layout %q not registered", want.Name)
		}
		if got.Name != want.Name {
			t.Errorf("ByName(%q).Name = %q", want.Name, got.Name)
		}
		if got.Fn == nil {
			t.Errorf("layout %q has nil Fn", want.Name)
		}
	}
}

func TestByName_Unknown(t *testing.T) {
	if _, ok := ByName("nope"); ok {
		t.Fatal("expected unknown layout to be unresolved")
	}
}

func TestNames_ContainsBuiltins(t *testing.T) {
	names := Names()
	seen := map[string]bool{}
	for _, n := range names {
		seen[n] = true
	}
	if !seen["defaultPage"] || !seen["docsPage"] {
		t.Errorf("Names() = %v, missing builtins", names)
	}
	// sorted
	for i := 1; i < len(names); i++ {
		if names[i-1] > names[i] {
			t.Errorf("Names() not sorted: %v", names)
		}
	}
}

func TestRegister_Panics(t *testing.T) {
	cases := map[string]Layout{
		"empty name": {Name: "", Fn: DefaultPage.Fn},
		"nil fn":     {Name: "x", Fn: nil},
		"duplicate":  DefaultPage,
	}
	for name, l := range cases {
		t.Run(name, func(t *testing.T) {
			defer func() {
				if recover() == nil {
					t.Errorf("Register(%+v) did not panic", l)
				}
			}()
			Register(l)
		})
	}
}
