package util

import (
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

func JsonEncode(input any) string {
	val, _ := json.Marshal(input)
	return string(val)
}

func Map[T any, R any](items []T, fx func(T) R) []R {
	var result []R
	for _, v := range items {
		result = append(result, fx(v))
	}
	return result
}

func MapHandleError[T any, R any](items []T, fx func(T) (R, error)) ([]R, error) {
	var result []R
	for i, v := range items {
		val, err := fx(v)
		if err != nil {
			return nil, fmt.Errorf("processing item %d (%v): %v", i, v, err)
		}
		result = append(result, val)
	}
	return result, nil
}

func ValuesToArray[K comparable, T any](in map[K]*T) []T {
	result := make([]T, 0, len(in))
	for _, v := range in {
		result = append(result, *v)
	}
	return result
}

func Int64P(i int64) *int64 {
	return &i
}

// ASCIIJSON writes every non-ASCII rune of a JSON text as its \u escape (a surrogate pair above U+FFFF), for a JSON
// header (X-Dashica-Diagnostics, X-Dashica-Column-Types): browsers read header bytes as Latin-1. Outside strings JSON
// is ASCII anyway, so the text stays the same JSON.
func ASCIIJSON(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r < utf8.RuneSelf:
			b.WriteRune(r)
		case r > 0xFFFF:
			hi, lo := utf16.EncodeRune(r)
			fmt.Fprintf(&b, `\u%04x\u%04x`, hi, lo)
		default:
			fmt.Fprintf(&b, `\u%04x`, r)
		}
	}
	return b.String()
}
