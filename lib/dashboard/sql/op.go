package sql

// Op is how a pill compares a field with its value (docs/2026-10-28-workbench.md §3.15 D25): `eq` (`=`), `ne`
// (`!=`), `lt` (`<`), `le` (`<=`), `gt` (`>`), `ge` (`>=`). Which ones the filter bar offers depends on the field's
// ClickHouse type (a string `eq` and `ne`, a number or a time all of them); every one is valid SQL on any field.
type Op string

const (
	OpEq Op = "eq"
	OpNe Op = "ne"
	OpLt Op = "lt"
	OpLe Op = "le"
	OpGt Op = "gt"
	OpGe Op = "ge"
)

// opSigns are each op's ClickHouse operator and the sign a chip shows.
var opSigns = map[Op]struct{ sql, shown string }{
	OpEq: {"=", "="},
	OpNe: {"!=", "≠"},
	OpLt: {"<", "<"},
	OpLe: {"<=", "≤"},
	OpGt: {">", ">"},
	OpGe: {">=", "≥"},
}

// Valid is whether `op` is one of the six ops.
func (op Op) Valid() bool {
	_, ok := opSigns[op]
	return ok
}

// Sign is the sign a chip shows for `op` (`=`, `≠`, `≤`): "customer ≠ acme".
func (op Op) Sign() string {
	return opSigns[op].shown
}

// Compare is the condition that `expression` compares by `op` with `value` as a string literal (Quote):
// `OpGe.Compare("duration_ms", "500")` is `duration_ms >= '500'`. ClickHouse converts the literal to the
// expression's type (a number, a DateTime) before comparing.
func (op Op) Compare(expression, value string) string {
	return expression + " " + opSigns[op].sql + " " + Quote(value)
}
