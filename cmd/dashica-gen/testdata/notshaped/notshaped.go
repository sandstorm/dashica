// Package notshaped has a type annotated //dashica-gen:enum that is no struct{ v string }, which findEnums refuses.
package notshaped

//dashica-gen:enum
type Curve string

const CurveLinear Curve = "linear"
