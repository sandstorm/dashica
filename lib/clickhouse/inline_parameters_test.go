// Tests for InlineParameters: values as literals that cannot end themselves, typed ones as CAST, placeholders inside
// literals, quoted identifiers and comments left alone, DateTimes parsed best-effort, the NULL marker as NULL.
package clickhouse

import "testing"

func TestInlineParameters(t *testing.T) {
	tests := map[string]struct {
		query  string
		params map[string]string
		want   string
	}{
		"a String value as a literal": {
			query:  "SELECT 1 WHERE host = {__f0:String}",
			params: map[string]string{"__f0": "web-1"},
			want:   "SELECT 1 WHERE host = 'web-1'",
		},
		"a quote, a backslash and a brace cannot end the literal": {
			query:  "WHERE a = {v:String}",
			params: map[string]string{"v": `x' OR 1=1 -- } \\`},
			want:   `WHERE a = 'x\' OR 1=1 -- } \\'`,
		},
		"escape sequences of the bound value read as ClickHouse reads them": {
			query:  "WHERE a = {v:String}",
			params: map[string]string{"v": `a\nb\tc\'d\x41\0e\q`},
			want:   "WHERE a = 'a\nb\tc\\'dA\\0eq'",
		},
		"a typed value as CAST, its type as the query names it": {
			query:  "WHERE timestamp >= {__from: UInt32} AND tags = {t:Array(String)}",
			params: map[string]string{"__from": "1761724800", "t": "['a','b']"},
			want:   `WHERE timestamp >= CAST('1761724800' AS UInt32) AND tags = CAST('[\'a\',\'b\']' AS Array(String))`,
		},
		"a DateTime or DateTime64 value parsed best-effort, the type's arguments passed on": {
			query:  "WHERE a >= {__from:DateTime64} AND b = {d:DateTime} AND c = {p:DateTime64(3)} AND d = {z:DateTime64(6, 'UTC')} AND e = {y:DateTime('UTC')}",
			params: map[string]string{"__from": "1761724800", "d": "2026-10-31T10:00", "p": "x'", "z": "1", "y": "2"},
			want:   `WHERE a >= parseDateTime64BestEffort('1761724800') AND b = parseDateTimeBestEffort('2026-10-31T10:00') AND c = parseDateTime64BestEffort('x\'', 3) AND d = parseDateTime64BestEffort('1', 6, 'UTC') AND e = parseDateTimeBestEffort('2', 'UTC')`,
		},
		"a DateTime inside another type stays a CAST": {
			query:  "WHERE a = {v:Nullable(DateTime)}",
			params: map[string]string{"v": "1761724800"},
			want:   "WHERE a = CAST('1761724800' AS Nullable(DateTime))",
		},
		"the NULL marker of a Nullable as NULL of its type, of any other type the character N": {
			query:  "WHERE a = {v:Nullable(String)} AND b = {s:String}",
			params: map[string]string{"v": `\N`, "s": `\N`},
			want:   "WHERE a = CAST(NULL AS Nullable(String)) AND b = 'N'",
		},
		"every occurrence": {
			query:  "{p:String} || {p:String}",
			params: map[string]string{"p": "x"},
			want:   "'x' || 'x'",
		},
		"inside a string literal, a quoted identifier and comments it stays": {
			query:  "SELECT '{p:String}', 'it''s {p:String}', 'a\\'{p:String}', `{p:String}`, \"{p:String}\" -- {p:String}\n/* {p:String} */ {p:String}",
			params: map[string]string{"p": "x"},
			want:   "SELECT '{p:String}', 'it''s {p:String}', 'a\\'{p:String}', `{p:String}`, \"{p:String}\" -- {p:String}\n/* {p:String} */ 'x'",
		},
		"one without a value stays": {
			query:  "WHERE a = {missing:String} AND b = {p:String}",
			params: map[string]string{"p": "x"},
			want:   "WHERE a = {missing:String} AND b = 'x'",
		},
		"braces that are no placeholder stay": {
			query:  "SELECT map('a', 1), {'a': 1} FROM t WHERE {p:String} != ''",
			params: map[string]string{"p": "x"},
			want:   "SELECT map('a', 1), {'a': 1} FROM t WHERE 'x' != ''",
		},
		"an unclosed literal ends with the text": {
			query:  "SELECT '{p:String}",
			params: map[string]string{"p": "x"},
			want:   "SELECT '{p:String}",
		},
	}
	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			if got := InlineParameters(tt.query, tt.params); got != tt.want {
				t.Errorf("InlineParameters =\n%s\nwant\n%s", got, tt.want)
			}
		})
	}
}
