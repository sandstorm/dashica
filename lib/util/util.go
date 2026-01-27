package util

import (
	"encoding/json"
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
