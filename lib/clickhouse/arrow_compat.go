package clickhouse

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"slices"
	"strings"
)

// This file makes arbitrary queries safe to serialize as Apache Arrow — the
// wire format every chart's data travels in (QueryToHandler with Format
// "Arrow"). ClickHouse has no Arrow serializer for its JSON / Object('json') /
// Dynamic / Variant column types, so any query whose RESULT contains such a
// column fails with e.g.
//
//	DB::Exception: The type 'JSON' of a column 'event_original' is not
//	supported for conversion into Arrow
//
// full_logs.event_original is exactly such a column, so a plain SELECT * over
// the main log table breaks. The transport layer handles it, so every caller
// (dashboards, the Explore view, raw .sql queries) gets it without knowing of it.
//
// The fix: DESCRIBE the query's result columns (no data read), and if any are
// Arrow-incompatible, wrap the query casting exactly those columns to String
// in place — every other column keeps its native type (numbers stay numbers
// for charts):
//
//	SELECT * REPLACE(toString(`c1`) AS `c1`, ...) FROM ( <original query> )

// arrowUnsafeTypeRe matches the ClickHouse types that cannot be converted into
// Arrow. Word boundaries so it also fires inside wrappers/containers
// (Nullable(JSON), Array(JSON), Object('json'), Variant(...), Dynamic).
var arrowUnsafeTypeRe = regexp.MustCompile(`(?i)\b(JSON|Object|Dynamic|Variant)\b`)

// arrowUnsafeType reports whether a ClickHouse type string cannot be serialized
// to Arrow.
func arrowUnsafeType(chType string) bool {
	return arrowUnsafeTypeRe.MatchString(chType)
}

// ensureArrowCompatible rewrites a query whose result contains Arrow-incompatible columns so it can be serialized to
// Arrow, and is a no-op otherwise. It only acts when Format is "Arrow" — the JSON/debug/alerting paths are untouched —
// and only when a DESCRIBE of the (already filter/placeholder-substituted) query reports at least one such column (or
// one opts.Cast casts). Detection is on the query RESULT, so it works uniformly for SqlQuery, SqlFile and SqlString
// with no SQL parsing.
//
// Cost is one DESCRIBE round-trip per Arrow query (~ms, reads no data);
// negligible next to the actual query and not cached (simpler, never stale).
// The DESCRIBE's columns come back too: their ClickHouse types before any cast (columnTypesHeader).
func (c *Client) ensureArrowCompatible(ctx context.Context, query string, opts QueryOptions) (string, []ResultColumn, error) {
	if !strings.EqualFold(opts.Format, "Arrow") {
		return query, nil, nil
	}

	// Both the DESCRIBE and the outer wrap embed the query as a subexpression
	// `( ... )`, where a trailing statement terminator is a syntax error.
	inner := trimTrailingSemicolons(query)

	cols, err := c.Describe(ctx, inner, opts)
	if err != nil {
		return "", nil, fmt.Errorf("arrow-compat describe: %w", err)
	}

	cast := opts.Cast
	if cast == nil {
		cast = castArrowUnsafe
	}
	wrapped, ok := buildArrowWrap(inner, cols, cast)
	if !ok {
		return query, cols, nil
	}
	return wrapped, cols, nil
}

// columnTypesHeader is X-Dashica-Column-Types for `columns`: each column's ClickHouse type by its name, as JSON,
// percent-encoded (`{"timestamp":"DateTime","host":"LowCardinality(String)"}`, as the browser's decodeURIComponent
// reads it; a column's name may be any text), the types the query's expressions have before the Arrow casts (a
// DateTime travels as UInt32 seconds), by which a click on a chart offers the ops its type allows; "" without columns.
func columnTypesHeader(columns []ResultColumn) string {
	if len(columns) == 0 {
		return ""
	}
	types := make(map[string]string, len(columns))
	for _, column := range columns {
		types[column.Name] = column.Type
	}
	b, _ := json.Marshal(types) // strings only; cannot fail
	return url.PathEscape(string(b))
}

// castArrowUnsafe casts what Arrow cannot carry (arrowUnsafeType) to String; the default QueryOptions.Cast.
func castArrowUnsafe(column, columnType string) string {
	if arrowUnsafeType(columnType) {
		return "toString(" + column + ")"
	}
	return ""
}

// PlainArrowCast is a QueryOptions.Cast that sends every column as one of the plain Arrow types Utf8, Bool, Int8-32,
// Uint8-32, Float32/64, Date32 and Timestamp in milliseconds: DateTime and DateTime64 as DateTime64(3) (ClickHouse
// sends DateTime as Uint32 seconds), Date as Date32 (else Uint16 days), 64-bit and wider integers, Decimal and
// BFloat16 as Float64 (exact up to 2^53), everything else (Enum, UUID, IPv4/IPv6, FixedString, Array, Map, Tuple,
// JSON) as String. Nullable and LowCardinality stay as they are around it.
func PlainArrowCast(column, columnType string) string {
	t := unwrapColumnType(columnType)
	switch {
	case slices.Contains([]string{"String", "Bool", "Int8", "Int16", "Int32", "UInt8", "UInt16", "UInt32", "Float32", "Float64", "Date32"}, t),
		strings.HasPrefix(t, "DateTime64(3)"), strings.HasPrefix(t, "DateTime64(3,"):
		return ""
	case t == "DateTime", strings.HasPrefix(t, "DateTime("), strings.HasPrefix(t, "DateTime64("):
		return "toDateTime64(" + column + ", 3)"
	case t == "Date":
		return "toDate32(" + column + ")"
	case slices.Contains([]string{"Int64", "UInt64", "Int128", "UInt128", "Int256", "UInt256", "BFloat16"}, t),
		strings.HasPrefix(t, "Decimal"):
		return "toFloat64(" + column + ")"
	default:
		return "toString(" + column + ")"
	}
}

// trimTrailingSemicolons strips trailing whitespace and statement terminators so
// the query can be embedded as a `( ... )` subexpression.
func trimTrailingSemicolons(query string) string {
	return strings.TrimRight(query, " \t\r\n;")
}

// buildArrowWrap wraps query in a pass-through SELECT that replaces each of `columns` by what `cast` gives for it
// (name in backquotes, type), preserving all other columns' names, order and native types; false when `cast` keeps
// every column.
//
// The outer SELECT has no ORDER BY of its own; ClickHouse preserves the
// subquery's order for a plain pass-through in practice. If that ever proves
// unreliable, apply SETTINGS max_threads=1 to wrapped queries only.
func buildArrowWrap(query string, columns []ResultColumn, cast func(column, columnType string) string) (string, bool) {
	var repls []string
	for _, col := range columns {
		name := "`" + strings.NewReplacer(`\`, `\\`, "`", "\\`").Replace(col.Name) + "`"
		if expression := cast(name, col.Type); expression != "" {
			repls = append(repls, expression+" AS "+name)
		}
	}
	if len(repls) == 0 {
		return query, false
	}
	return fmt.Sprintf("SELECT * REPLACE(%s) FROM (\n%s\n)", strings.Join(repls, ", "), query), true
}

// ResultColumn is a column of a query's result as DESCRIBE reports it: its name and ClickHouse type.
type ResultColumn struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

// Describe returns the result columns (name + type) of an arbitrary query, in their order,
// WITHOUT executing it, via DESCRIBE (<query>), a trailing `;` of the query trimmed. The same parameters/settings
// are passed through so parameterized queries ({param:Type}) describe fine.
func (c *Client) Describe(ctx context.Context, query string, opts QueryOptions) ([]ResultColumn, error) {
	res, err := QueryJSON[ResultColumn](ctx, c, "DESCRIBE (\n"+trimTrailingSemicolons(query)+"\n)", opts)
	if err != nil {
		return nil, err
	}
	return res.Data, nil
}
