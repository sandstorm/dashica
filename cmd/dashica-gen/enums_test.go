package main

import (
	"go/format"
	"strings"
	"testing"

	"golang.org/x/tools/go/packages"
)

func TestFindEnums_RefusesWhatIsNotAnnotatedOrNotShaped(t *testing.T) {
	for dir, want := range map[string]string{
		"./testdata/unannotated": "unannotated.Curve is a struct{ v string }: annotate it //dashicagen:enum",
		"./testdata/notshaped":   "notshaped.Curve is annotated //dashicagen:enum but is no struct{ v string }",
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

// -enums loads the syntax only, so it writes the methods of a package that needs them to compile.
func TestFindEnums_ReadsTheSyntaxOnly(t *testing.T) {
	pkgs, err := packages.Load(&packages.Config{Mode: packages.NeedName | packages.NeedFiles | packages.NeedSyntax}, "./testdata/selfuse")
	if err != nil || len(pkgs) != 1 {
		t.Fatalf("load: %v", err)
	}
	enums, err := findEnums(pkgs[0])
	if err != nil {
		t.Fatal(err)
	}
	if values := enums["Curve"].Values; len(values) != 2 || values[1].VarName != "CurveStep" || values[1].Str != "step" {
		t.Errorf("Curve values = %+v, want CurveLinear=linear, CurveStep=step", values)
	}
}

// gofmt keeps a directive (`//name:…`, name in lowercase letters and digits) as written, and puts a space into any
// other comment: the annotation has to be one, or formatting the file loses the enum.
func TestEnumAnnotation_IsKeptByGofmt(t *testing.T) {
	src := "package x\n\n// Curve is a curve.\n//\n" + enumAnnotation + "\ntype Curve struct{ v string }\n"
	formatted, err := format.Source([]byte(src))
	if err != nil || !strings.Contains(string(formatted), "\n"+enumAnnotation+"\n") {
		t.Errorf("gofmt changed the annotation: %s (%v)", formatted, err)
	}
}
