package clickhouse

import (
	"regexp"
	"strconv"
	"strings"
)

// InlineParameters is `query` with each placeholder `{name:Type}` that has a value in `params` written in as a
// literal: the SQL the Explore view's editor starts from, which runs as it is, without parameters. A `String`
// placeholder becomes a string literal (`{__f0:String}` → `'web-1'`); a `DateTime` or `DateTime64` one the
// best-effort parse of it, as ClickHouse parses a bound one with `date_time_input_format=best_effort`
// (`{__from:DateTime64}` → `parseDateTime64BestEffort('1761724800')`, the type's precision and time zone passed on);
// a `Nullable(...)` one with the value `\N` `CAST(NULL AS Nullable(...))`; any other type `CAST('<value>' AS Type)`
// (`{__from:UInt32}` → `CAST('1761724800' AS UInt32)`), its type the one the query names. The value is first read
// as ClickHouse reads a bound parameter (escape sequences, decodeEscaped), then quoted with `\` and `'` escaped (a NUL
// byte as `\0`), so it is a literal whatever it holds. Placeholders inside string literals, quoted identifiers and
// comments stay, as does one without a value: ClickHouse names it when the text runs.
func InlineParameters(query string, params map[string]string) string {
	var out strings.Builder
	for i := 0; i < len(query); {
		if end := skipped(query, i); end > i {
			out.WriteString(query[i:end])
			i = end
			continue
		}
		if query[i] == '{' {
			if m := placeholderRe.FindStringSubmatch(query[i:]); m != nil {
				if value, ok := params[m[1]]; ok {
					out.WriteString(literal(value, strings.TrimSpace(m[2])))
					i += len(m[0])
					continue
				}
			}
		}
		out.WriteByte(query[i])
		i++
	}
	return out.String()
}

// placeholderRe is a query parameter at the start of the text: `{name:Type}`, its type without braces.
var placeholderRe = regexp.MustCompile(`^\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^{}]+?)\s*\}`)

// skipped is the end of the string literal, quoted identifier or comment that starts at `i` in `query`; `i` when
// none starts there. One that is not closed ends with the text.
func skipped(query string, i int) int {
	switch {
	case query[i] == '\'' || query[i] == '"' || query[i] == '`':
		quote := query[i]
		for j := i + 1; j < len(query); j++ {
			switch query[j] {
			case '\\':
				j++
			case quote:
				// a doubled quote is one quote inside
				if j+1 < len(query) && query[j+1] == quote {
					j++
					continue
				}
				return j + 1
			}
		}
		return len(query)
	case strings.HasPrefix(query[i:], "--"):
		if end := strings.IndexByte(query[i:], '\n'); end >= 0 {
			return i + end + 1
		}
		return len(query)
	case strings.HasPrefix(query[i:], "/*"):
		if end := strings.Index(query[i+2:], "*/"); end >= 0 {
			return i + 2 + end + 2
		}
		return len(query)
	}
	return i
}

// literal is the bound parameter value `value` (Escaped) as a literal of the ClickHouse type `typ`: see
// InlineParameters.
func literal(value, typ string) string {
	if value == `\N` && strings.HasPrefix(typ, "Nullable(") {
		return "CAST(NULL AS " + typ + ")"
	}
	quoted := "'" + strings.NewReplacer(`\`, `\\`, `'`, `\'`, "\x00", `\0`).Replace(decodeEscaped(value)) + "'"
	if typ == "String" {
		return quoted
	}
	if m := dateTimeRe.FindStringSubmatch(typ); m != nil {
		args := ""
		if strings.TrimSpace(m[2]) != "" {
			args = ", " + strings.TrimSpace(m[2])
		}
		return "parse" + m[1] + "BestEffort(" + quoted + args + ")"
	}
	return "CAST(" + quoted + " AS " + typ + ")"
}

// dateTimeRe is a `DateTime` or `DateTime64` type, its arguments (precision, time zone) the ones of
// parseDateTimeBestEffort / parseDateTime64BestEffort.
var dateTimeRe = regexp.MustCompile(`^(DateTime|DateTime64)\s*(?:\((.*)\))?$`)

// decodeEscaped is `value` as ClickHouse reads a bound parameter's value, in the Escaped format: `\n`, `\t`, `\r`,
// `\b`, `\f`, `\0`, `\a`, `\v`, `\xHH` the bytes they name, a backslash before any other character that character
// (`\\`, `\'`).
func decodeEscaped(value string) string {
	if !strings.Contains(value, `\`) {
		return value
	}
	var out strings.Builder
	for i := 0; i < len(value); i++ {
		if value[i] != '\\' || i+1 == len(value) {
			out.WriteByte(value[i])
			continue
		}
		i++
		switch c := value[i]; c {
		case 'n':
			out.WriteByte('\n')
		case 't':
			out.WriteByte('\t')
		case 'r':
			out.WriteByte('\r')
		case 'b':
			out.WriteByte('\b')
		case 'f':
			out.WriteByte('\f')
		case '0':
			out.WriteByte(0)
		case 'a':
			out.WriteByte('\a')
		case 'v':
			out.WriteByte('\v')
		case 'x':
			if i+2 < len(value) {
				if b, err := strconv.ParseUint(value[i+1:i+3], 16, 8); err == nil {
					out.WriteByte(byte(b))
					i += 2
					continue
				}
			}
			out.WriteByte(c)
		default:
			out.WriteByte(c)
		}
	}
	return out.String()
}
