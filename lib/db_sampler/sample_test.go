package db_sampler

import (
	"path/filepath"
	"reflect"
	"testing"
)

func TestWriteSplitReadSplitRoundtrip(t *testing.T) {
	card := 2
	src := TableProfile{
		Metadata: ProfileMetadata{
			Table:            "tbl",
			Database:         "db",
			TotalRowsApprox:  100,
			BucketDimensions: []string{"event_dataset", "level"},
			SortingKey:       []string{"timestamp"},
			AppliedWhere:     "`timestamp` > now() - INTERVAL 1 HOUR",
		},
		ColumnStats: map[string]ColumnStat{
			"level": {Type: "LowCardinality(String)", Cardinality: &card, Values: []ColumnValue{
				{Value: "info", Count: 80}, {Value: "error", Count: 20},
			}},
		},
		Buckets: []Bucket{
			{Dims: map[string]any{"event_dataset": "ds_one", "level": "info"}, Count: 50, Samples: []map[string]any{
				{"msg": "hello"},
			}},
			{Dims: map[string]any{"event_dataset": "ds two/extra!", "level": "error"}, Count: 5, Samples: []map[string]any{
				{"msg": "boom"},
			}},
		},
	}

	dir := t.TempDir()
	if err := src.WriteSplit(dir); err != nil {
		t.Fatalf("WriteSplit: %v", err)
	}
	matches := nonOverviewJSON(t, dir)
	if len(matches) != 2 {
		t.Fatalf("expected 2 bucket files, got %d (%v)", len(matches), matches)
	}

	got, err := ReadSplit(dir)
	if err != nil {
		t.Fatalf("ReadSplit: %v", err)
	}
	if got.Metadata.AppliedWhere != src.Metadata.AppliedWhere {
		t.Errorf("metadata roundtrip: %q vs %q", got.Metadata.AppliedWhere, src.Metadata.AppliedWhere)
	}
	if len(got.Buckets) != 2 {
		t.Fatalf("buckets: got %d", len(got.Buckets))
	}
	// dim values that needed sanitizing should still come back intact
	wantDims := src.Buckets[1].Dims
	if !reflect.DeepEqual(got.Buckets[1].Dims, wantDims) {
		t.Errorf("dims roundtrip: %v vs %v", got.Buckets[1].Dims, wantDims)
	}
}

func TestWriteSplitOverwritesStaleBuckets(t *testing.T) {
	dir := t.TempDir()
	prof := TableProfile{
		Metadata: ProfileMetadata{Table: "t"},
		Buckets: []Bucket{
			{Dims: map[string]any{"x": "first"}, Count: 1},
			{Dims: map[string]any{"x": "second"}, Count: 1},
		},
	}
	if err := prof.WriteSplit(dir); err != nil {
		t.Fatal(err)
	}
	// Second run with fewer buckets — orphans must be cleaned out.
	prof2 := TableProfile{
		Metadata: ProfileMetadata{Table: "t"},
		Buckets:  []Bucket{{Dims: map[string]any{"x": "only"}, Count: 1}},
	}
	if err := prof2.WriteSplit(dir); err != nil {
		t.Fatal(err)
	}
	matches := nonOverviewJSON(t, dir)
	if len(matches) != 1 {
		t.Fatalf("stale buckets not cleaned, got %d files: %v", len(matches), matches)
	}
}

func TestAnonymizeProfileScrubsDims(t *testing.T) {
	src := TableProfile{
		Metadata: ProfileMetadata{Table: "ingress"},
		Buckets: []Bucket{
			{
				Dims:  map[string]any{"host": "178.63.128.131", "method": "GET"},
				Count: 5,
				Samples: []map[string]any{
					{"host": "178.63.128.131", "method": "GET"},
				},
			},
		},
	}
	got := AnonymizeProfile(src, DefaultProcessor())
	if got.Buckets[0].Dims["host"] == "178.63.128.131" {
		t.Fatalf("dim leaked raw IP: %v", got.Buckets[0].Dims)
	}
	if got.Buckets[0].Samples[0]["host"] == "178.63.128.131" {
		t.Fatalf("sample leaked raw IP: %v", got.Buckets[0].Samples[0])
	}
	if got.Buckets[0].Dims["method"] != "GET" {
		t.Errorf("non-PII dim mutated: %v", got.Buckets[0].Dims["method"])
	}
}

func nonOverviewJSON(t *testing.T, dir string) []string {
	t.Helper()
	all, _ := filepath.Glob(filepath.Join(dir, "*.json"))
	out := make([]string, 0, len(all))
	for _, p := range all {
		if filepath.Base(p) == "overview.json" {
			continue
		}
		out = append(out, p)
	}
	return out
}
