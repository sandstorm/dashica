// Package selfuse calls String() on its own enum, which compiles only with its zz_generated.enums.go: findEnums reads
// it from the syntax.
package selfuse

//dashicagen:enum
type Curve struct{ v string }

var (
	CurveLinear = Curve{"linear"}
	CurveStep   = Curve{"step"}
)

func Name() string { return CurveLinear.String() }
