package clickhouse

import "testing"

func TestClassifyColumnType(t *testing.T) {
	cases := map[string]string{
		// temporal
		"Date":                     ColumnClassTemporal,
		"Date32":                   ColumnClassTemporal,
		"DateTime":                 ColumnClassTemporal,
		"DateTime64(3)":            ColumnClassTemporal,
		"DateTime('Europe/Paris')": ColumnClassTemporal,
		// continuous
		"Int8":          ColumnClassContinuous,
		"Int64":         ColumnClassContinuous,
		"UInt32":        ColumnClassContinuous,
		"Float64":       ColumnClassContinuous,
		"Decimal(10,2)": ColumnClassContinuous,
		// categorical
		"String":          ColumnClassCategorical,
		"FixedString(16)": ColumnClassCategorical,
		"Enum8('a' = 1)":  ColumnClassCategorical,
		"Enum16('x' = 1)": ColumnClassCategorical,
		"UUID":            ColumnClassCategorical,
		"IPv4":            ColumnClassCategorical,
		"IPv6":            ColumnClassCategorical,
		"Bool":            ColumnClassCategorical,
		"Boolean":         ColumnClassCategorical,
		// wrappers unwrap to the inner class
		"Nullable(String)":                 ColumnClassCategorical,
		"LowCardinality(String)":           ColumnClassCategorical,
		"Nullable(DateTime)":               ColumnClassTemporal,
		"LowCardinality(Nullable(String))": ColumnClassCategorical,
		"Nullable(Int64)":                  ColumnClassContinuous,
		// unknown → neutral
		"Array(String)":        "",
		"Map(String, String)":  "",
		"Tuple(Int64, String)": "",
	}
	for typ, want := range cases {
		if got := ClassifyColumnType(typ); got != want {
			t.Errorf("ClassifyColumnType(%q) = %q, want %q", typ, got, want)
		}
	}
}
