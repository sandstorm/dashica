// Package unannotated has an enum-shaped type without //dashica-gen:enum, which findEnums refuses.
package unannotated

type Curve struct{ v string }

var CurveLinear = Curve{"linear"}
