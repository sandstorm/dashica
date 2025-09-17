package util

func ValuesToArray[K comparable, T any](in map[K]*T) []T {
	result := make([]T, 0, len(in))
	for _, v := range in {
		result = append(result, *v)
	}
	return result
}
