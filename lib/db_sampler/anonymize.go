// Package db_sampler dumps DB schemas, samples tables, and anonymizes the result
// so AI tools can be given dashboard-authoring context without seeing prod data.
//
// The anonymizer is built around composable Processors. A Processor is a pure
// function transforming one (field, value) pair. Compose with Chain; ship a sane
// default with DefaultProcessor; extend by appending more Processors.
package db_sampler

import (
	"bufio"
	"encoding/json"
	"fmt"
	"hash/crc32"
	"io"
	"math"
	"net"
	"regexp"
	"strings"
	"unicode"
)

// Processor transforms a single (field, value) pair. Returning skip=true drops
// the field; otherwise the (possibly mutated) value is kept and passed to the
// next processor in a Chain.
type Processor func(field string, value any) (newValue any, skip bool)

// Chain runs processors left-to-right. Each sees the output of the previous.
// If any processor returns skip=true the field is dropped and remaining
// processors are not invoked for that field.
func Chain(ps ...Processor) Processor {
	return func(field string, value any) (any, bool) {
		for _, p := range ps {
			if p == nil {
				continue
			}
			v, skip := p(field, value)
			if skip {
				return nil, true
			}
			value = v
		}
		return value, false
	}
}

// AnonymizeRow walks a row and applies p to every field. Recurses into nested
// maps (string-keyed) and slices.
func AnonymizeRow(row map[string]any, p Processor) map[string]any {
	out := make(map[string]any, len(row))
	for k, v := range row {
		nv, skip := p(k, v)
		if skip {
			continue
		}
		out[k] = walkNested(k, nv, p)
	}
	return out
}

func walkNested(field string, v any, p Processor) any {
	switch x := v.(type) {
	case map[string]any:
		return AnonymizeRow(x, p)
	case []any:
		out := make([]any, 0, len(x))
		for _, item := range x {
			nv, skip := p(field, item)
			if skip {
				continue
			}
			out = append(out, walkNested(field, nv, p))
		}
		return out
	default:
		return v
	}
}

// AnonymizeJSONLStream reads JSONL rows from in, anonymizes each, writes JSONL
// to out. Blank lines and undecodable lines are skipped.
func AnonymizeJSONLStream(in io.Reader, out io.Writer, p Processor) error {
	scanner := bufio.NewScanner(in)
	scanner.Buffer(make([]byte, 64*1024), 16*1024*1024)
	enc := json.NewEncoder(out)
	enc.SetEscapeHTML(false)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var row map[string]any
		if err := json.Unmarshal([]byte(line), &row); err != nil {
			continue
		}
		if err := enc.Encode(AnonymizeRow(row, p)); err != nil {
			return fmt.Errorf("encode anonymized row: %w", err)
		}
	}
	return scanner.Err()
}

// ─── Built-in processor factories ────────────────────────────────────────────

// ColumnAction names a structural-column replacement strategy.
type ColumnAction int

const (
	ScrambleEmail ColumnAction = iota
	ScrambleIPAction
	ScrambleName
	// ReplaceWith uses a literal string replacement; build via NewReplaceWith.
	replaceWithSentinel
)

// ColumnRule pairs a column name (case-insensitive exact match) with an action
// or literal replacement.
type ColumnRule struct {
	Action      ColumnAction
	Replacement string // used when Action == replaceWithSentinel
}

// ReplaceWith returns a ColumnRule that replaces matching column values with
// the literal string s.
func ReplaceWith(s string) ColumnRule {
	return ColumnRule{Action: replaceWithSentinel, Replacement: s}
}

// Action wraps a ColumnAction enum into a ColumnRule.
func Action(a ColumnAction) ColumnRule { return ColumnRule{Action: a} }

// StructuralColumns matches field names case-insensitively and replaces the
// value according to the rule. Non-string values are coerced to string first.
// Empty strings pass through unchanged.
func StructuralColumns(rules map[string]ColumnRule) Processor {
	lower := make(map[string]ColumnRule, len(rules))
	for k, v := range rules {
		lower[strings.ToLower(k)] = v
	}
	return func(field string, value any) (any, bool) {
		rule, ok := lower[strings.ToLower(field)]
		if !ok {
			return value, false
		}
		s, isString := coerceString(value)
		if !isString || s == "" {
			return value, false
		}
		switch rule.Action {
		case ScrambleEmail, ScrambleName:
			return ScrambleAlphanumeric(s), false
		case ScrambleIPAction:
			return ScrambleIP(s), false
		case replaceWithSentinel:
			return rule.Replacement, false
		}
		return value, false
	}
}

// TextRegex returns a Processor that applies one regex substitution to every
// string value. Compose multiple via Chain to layer rules.
func TextRegex(pattern *regexp.Regexp, replacement string) Processor {
	return func(_ string, value any) (any, bool) {
		s, ok := value.(string)
		if !ok {
			return value, false
		}
		return pattern.ReplaceAllString(s, replacement), false
	}
}

// RedactHighEntropyTokens replaces whitespace-separated tokens whose Shannon
// entropy meets or exceeds threshold and whose length is at least minTokenLen
// with "<SECRET>". Only applies to string values.
func RedactHighEntropyTokens(threshold float64, minTokenLen int) Processor {
	tokenRe := regexp.MustCompile(`\S+`)
	return func(_ string, value any) (any, bool) {
		s, ok := value.(string)
		if !ok {
			return value, false
		}
		return tokenRe.ReplaceAllStringFunc(s, func(tok string) string {
			if len(tok) >= minTokenLen && ShannonEntropy(tok) >= threshold {
				return "<SECRET>"
			}
			return tok
		}), false
	}
}

// DropFields drops the named fields from rows (case-sensitive exact match).
func DropFields(names ...string) Processor {
	set := make(map[string]struct{}, len(names))
	for _, n := range names {
		set[n] = struct{}{}
	}
	return func(field string, value any) (any, bool) {
		if _, ok := set[field]; ok {
			return nil, true
		}
		return value, false
	}
}

// TruncateFields replaces the value of named fields with "<TRUNCATED>".
func TruncateFields(names ...string) Processor {
	set := make(map[string]struct{}, len(names))
	for _, n := range names {
		set[n] = struct{}{}
	}
	return func(field string, value any) (any, bool) {
		if _, ok := set[field]; ok {
			return "<TRUNCATED>", false
		}
		return value, false
	}
}

// ─── Helpers (also exported for use inside custom processors) ────────────────

// ScrambleAlphanumeric deterministically replaces letters and digits with other
// letters/digits, preserving case and non-alphanumeric characters. crc32-seeded
// so the same input yields the same output across runs (matches anonymize-lib.php).
func ScrambleAlphanumeric(s string) string {
	if s == "" {
		return s
	}
	seed := uint32(crc32.ChecksumIEEE([]byte(s)))
	out := make([]rune, 0, len(s))
	i := 0
	for _, r := range s {
		seed = seed*1103515245 + 12345 + uint32(i)
		seed &= 0x7fffffff
		switch {
		case unicode.IsUpper(r):
			out = append(out, rune('A'+seed%26))
		case unicode.IsLower(r):
			out = append(out, rune('a'+seed%26))
		case unicode.IsDigit(r):
			out = append(out, rune('0'+seed%10))
		default:
			out = append(out, r)
		}
		i++
	}
	return string(out)
}

// ScrambleIP returns a deterministic pseudo-IP for input s. Empty/zero strings
// pass through. Detects v4 vs v6 by ':' presence.
func ScrambleIP(s string) string {
	if s == "" || s == "0.0.0.0" || s == "::" {
		return s
	}
	if strings.Contains(s, ":") {
		segs := strings.Split(s, ":")
		out := make([]string, len(segs))
		for i, seg := range segs {
			if seg == "" {
				continue
			}
			h := crc32.ChecksumIEEE([]byte(s + ":" + itoa(i)))
			out[i] = fmt.Sprintf("%04x", h&0xffff)
		}
		return strings.Join(out, ":")
	}
	if net.ParseIP(s) != nil || strings.Contains(s, ".") {
		h := crc32.ChecksumIEEE([]byte(s))
		return fmt.Sprintf("%d.%d.%d.%d",
			(h>>24)&0xff, (h>>16)&0xff, (h>>8)&0xff, h&0xff)
	}
	return s
}

// ShannonEntropy returns the per-character Shannon entropy of s in bits.
func ShannonEntropy(s string) float64 {
	if s == "" {
		return 0
	}
	freq := make(map[byte]int, len(s))
	for i := 0; i < len(s); i++ {
		freq[s[i]]++
	}
	n := float64(len(s))
	var h float64
	for _, c := range freq {
		p := float64(c) / n
		h -= p * math.Log2(p)
	}
	return h
}

func coerceString(v any) (string, bool) {
	switch x := v.(type) {
	case string:
		return x, true
	case json.Number:
		return x.String(), true
	case float64:
		return fmt.Sprintf("%g", x), true
	case int, int64, int32:
		return fmt.Sprintf("%d", x), true
	case bool:
		if x {
			return "true", true
		}
		return "false", true
	}
	return "", false
}

func itoa(i int) string { return fmt.Sprintf("%d", i) }
