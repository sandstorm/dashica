package clickhouse

import (
	"strings"
)

// Column describes one table column: its name, ClickHouse type, comment, and
// its semantic class (see ClassifyColumnType).
type Column struct {
	Name    string `json:"name"`
	Type    string `json:"type"`
	Comment string `json:"comment,omitempty"`
	// Class is the semantic column class the Explore editor speaks in:
	// "temporal", "categorical", "continuous", or "" when unknown. This is the
	// single home for the ClickHouse-type → class mapping; the editor derives
	// slot-aware pickers, badges, and value affordances from it.
	Class string `json:"class,omitempty"`
}

// Column class constants — the vocabulary the Explore editor speaks: temporal (time axes), categorical/ordinal (fills,
// facets, WHERE values), continuous/numeric (aggregations). Kept as plain strings on the wire.
const (
	ColumnClassTemporal    = "temporal"
	ColumnClassCategorical = "categorical"
	ColumnClassContinuous  = "continuous"
)

// ClassifyColumnType maps a ClickHouse column type to its semantic class. It is
// the one place the mapping lives, so the editor's language and Observable
// Plot's scale semantics (time / ordinal / linear) agree. Wrappers
// (Nullable/LowCardinality) are unwrapped first; an unrecognised type yields ""
// (neutral — the editor neither prefers nor demotes it).
func ClassifyColumnType(chType string) string {
	t := unwrapColumnType(chType)

	switch {
	case strings.HasPrefix(t, "Date"): // Date, Date32, DateTime, DateTime64
		return ColumnClassTemporal
	case strings.HasPrefix(t, "Int"), strings.HasPrefix(t, "UInt"),
		strings.HasPrefix(t, "Float"), strings.HasPrefix(t, "Decimal"):
		return ColumnClassContinuous
	case strings.HasPrefix(t, "String"), strings.HasPrefix(t, "FixedString"),
		strings.HasPrefix(t, "Enum"), strings.HasPrefix(t, "UUID"),
		strings.HasPrefix(t, "IPv"), t == "Bool", t == "Boolean":
		return ColumnClassCategorical
	default:
		return ""
	}
}
