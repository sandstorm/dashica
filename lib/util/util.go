package util

import (
	"encoding/json"
	"fmt"
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
