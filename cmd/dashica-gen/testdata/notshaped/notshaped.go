// Package notshaped has a type annotated //dashicagen:enum that is no struct{ v string }, which findEnums refuses.
package notshaped

//dashicagen:enum
type Curve string

const CurveLinear Curve = "linear"
