package clickhouse

import (
	"context"
	"fmt"
	"regexp"
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
// the main log table breaks. This concern belongs to the transport layer, not
// to widgets or the frontend: fixing it here fixes every caller (compiled
// dashboards, dynamic Explore previews, the Data-tab sample, raw .sql queries)
// with zero widget/UI knowledge.
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

// ensureArrowCompatible rewrites a query whose result contains Arrow-incompatible
// columns so it can be serialized to Arrow, and is a no-op otherwise. It only
// acts when Format is "Arrow" — the JSON/debug/alerting paths are untouched —
// and only when a DESCRIBE of the (already filter/placeholder-substituted)
// query reports at least one such column. Detection is on the query RESULT, so
// it works uniformly for SqlQuery, SqlFile and SqlString with no SQL parsing.
//
// Cost is one DESCRIBE round-trip per Arrow query (~ms, reads no data);
// negligible next to the actual query and not cached (simpler, never stale).
func (c *Client) ensureArrowCompatible(ctx context.Context, query string, opts QueryOptions) (string, error) {
	if !strings.EqualFold(opts.Format, "Arrow") {
		return query, nil
	}

	// Both the DESCRIBE and the outer wrap embed the query as a subexpression
	// `( ... )`, where a trailing statement terminator is a syntax error.
	inner := trimTrailingSemicolons(query)

	cols, err := c.describeQuery(ctx, inner, opts)
	if err != nil {
		return "", fmt.Errorf("arrow-compat describe: %w", err)
	}

	var unsafe []string
	for _, col := range cols {
		if arrowUnsafeType(col.Type) {
			unsafe = append(unsafe, col.Name)
		}
	}
	if len(unsafe) == 0 {
		return query, nil
	}
	return buildArrowWrap(inner, unsafe), nil
}

// trimTrailingSemicolons strips trailing whitespace and statement terminators so
// the query can be embedded as a `( ... )` subexpression.
func trimTrailingSemicolons(query string) string {
	return strings.TrimRight(query, " \t\r\n;")
}

// buildArrowWrap wraps query in a pass-through SELECT that casts exactly the
// named columns to String via REPLACE, preserving all other columns' names,
// order and native types. Column names are backtick-escaped.
//
// The outer SELECT has no ORDER BY of its own; ClickHouse preserves the
// subquery's order for a plain pass-through in practice. If that ever proves
// unreliable, apply SETTINGS max_threads=1 to wrapped queries only.
func buildArrowWrap(query string, unsafeCols []string) string {
	repls := make([]string, len(unsafeCols))
	for i, name := range unsafeCols {
		repls[i] = fmt.Sprintf("toString(`%s`) AS `%s`", name, name)
	}
	return fmt.Sprintf("SELECT * REPLACE(%s) FROM (\n%s\n)", strings.Join(repls, ", "), query)
}

// describeRow is one row of DESCRIBE output (only the columns we need).
type describeRow struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

// describeQuery returns the result columns (name + type) of an arbitrary query
// WITHOUT executing it, via DESCRIBE (<query>). The same parameters/settings
// are passed through so parameterized queries ({param:Type}) describe fine.
func (c *Client) describeQuery(ctx context.Context, query string, opts QueryOptions) ([]describeRow, error) {
	res, err := QueryJSON[describeRow](ctx, c, "DESCRIBE (\n"+query+"\n)", opts)
	if err != nil {
		return nil, err
	}
	return res.Data, nil
}
