package main

import (
	"strings"
	"testing"

	"golang.org/x/tools/go/packages"
)

func TestFindEnums_RefusesWhatIsNotAnnotatedOrNotShaped(t *testing.T) {
	for dir, want := range map[string]string{
		"./testdata/unannotated": "unannotated.Curve is a struct{ v string }: annotate it //dashica-gen:enum",
		"./testdata/notshaped":   "notshaped.Curve is annotated //dashica-gen:enum but is no struct{ v string }",
		"./testdata/novalues":    "novalues.Curve has no values",
	} {
		pkgs, err := packages.Load(&packages.Config{Mode: packages.NeedName | packages.NeedSyntax | packages.NeedTypes}, dir)
		if err != nil || len(pkgs) != 1 {
			t.Fatalf("load %s: %v", dir, err)
		}
		if _, err := findEnums(pkgs[0]); err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("%s: got %v, want %q", dir, err, want)
		}
	}
}
