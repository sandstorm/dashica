package sql

import (
	"encoding/json"
	"testing"
)

// roundTripField marshals f via the envelope helper and unmarshals it back.
func roundTripField(t *testing.T, f SqlField) SqlField {
	t.Helper()
	b, err := MarshalField(f)
	if err != nil {
		t.Fatalf("MarshalField: %v", err)
	}
	got, err := UnmarshalField(b)
	if err != nil {
		t.Fatalf("UnmarshalField(%s): %v", b, err)
	}
	return got
}

func TestFieldRoundTrip(t *testing.T) {
	tests := []struct {
		name  string
		field SqlField
	}{
		{"expr", Field("count(*) / 2")},
		{"count", Count()},
		{"count with alias", Count().WithAlias("logs")},
		{"enum", Enum("level")},
		{"enum with alias", Enum("level").WithAlias("lvl")},
		{"autoBucket", AutoBucket("timestamp")},
		{"autoBucket with alias", AutoBucketAs("ts", "bucket")},
		{"timestamp15", Timestamp15Min()},
		{"timestampField", TimestampField("toStartOfHour(ts)::DateTime64", "time", 3600000)},
		{"jsonExtract", JsonExtractString("payload", "user", "id")},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := roundTripField(t, tt.field)
			if got.Definition() != tt.field.Definition() {
				t.Errorf("Definition: got %q want %q", got.Definition(), tt.field.Definition())
			}
			if got.Alias() != tt.field.Alias() {
				t.Errorf("Alias: got %q want %q", got.Alias(), tt.field.Alias())
			}
			wantTS, wantIsTS := tt.field.(TimestampedField)
			gotTS, gotIsTS := got.(TimestampedField)
			if wantIsTS != gotIsTS {
				t.Fatalf("TimestampedField-ness changed: got %v want %v", gotIsTS, wantIsTS)
			}
			if wantIsTS && gotTS.XBucketSizeMs() != wantTS.XBucketSizeMs() {
				t.Errorf("XBucketSizeMs: got %d want %d", gotTS.XBucketSizeMs(), wantTS.XBucketSizeMs())
			}
		})
	}
}

func TestFieldKindWireFormat(t *testing.T) {
	// The "kind" discriminator must survive so downstream codegen can pick the
	// idiomatic constructor.
	b, err := MarshalField(Count().WithAlias("logs"))
	if err != nil {
		t.Fatal(err)
	}
	var dto fieldDTO
	if err := json.Unmarshal(b, &dto); err != nil {
		t.Fatal(err)
	}
	if dto.Kind != "count" {
		t.Errorf("kind: got %q want %q (wire: %s)", dto.Kind, "count", b)
	}
	if dto.Alias != "logs" {
		t.Errorf("alias: got %q want %q", dto.Alias, "logs")
	}
}

func TestUnmarshalFieldUnknownKind(t *testing.T) {
	_, err := UnmarshalField([]byte(`{"kind":"banana"}`))
	if err == nil {
		t.Fatal("expected error for unknown field kind")
	}
}

func TestUnmarshalFieldNull(t *testing.T) {
	got, err := UnmarshalField([]byte("null"))
	if err != nil {
		t.Fatal(err)
	}
	if got != nil {
		t.Errorf("expected nil for JSON null, got %#v", got)
	}
}

// roundTripQueryable marshals q via the envelope helper and unmarshals it back.
func roundTripQueryable(t *testing.T, q SqlQueryable) SqlQueryable {
	t.Helper()
	b, err := MarshalQueryable(q)
	if err != nil {
		t.Fatalf("MarshalQueryable: %v", err)
	}
	got, err := UnmarshalQueryable(b)
	if err != nil {
		t.Fatalf("UnmarshalQueryable(%s): %v", b, err)
	}
	return got
}

func TestQueryableRoundTripBuildIdentical(t *testing.T) {
	tests := []struct {
		name  string
		query SqlQueryable
	}{
		{
			"simple table",
			New(From("full_logs"), Where("level = 'error'")),
		},
		{
			"table with fields",
			New(
				From("full_logs"),
				Where("level = 'error' OR level = 'fatal'"),
				PrependSelect(AutoBucket("timestamp")),
				Select(Count().WithAlias("logs")),
				GroupBy(AutoBucket("timestamp")),
				OrderBy(AutoBucket("timestamp")),
				Limit(100),
			),
		},
		{
			"table with fill and database",
			New(
				From("metrics"),
				Select(Field("max(pct)").WithAlias("pct")),
				OrderBy(Field("time")),
				WithFill("toIntervalHour(1)"),
				OnDatabase("analytics"),
				SkipFilters(),
			),
		},
		{
			"file",
			FromFile("src/p_wetell/overview.sql"),
		},
		{
			"raw string",
			FromString("SELECT * FROM x WHERE {{DASHICA_FILTERS}}"),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := roundTripQueryable(t, tt.query)
			// Build() is the authoritative round-trip invariant, but SqlFile.Build
			// reads from disk (and panics without the file) — its equivalence is
			// covered by the marshal-idempotence check below instead.
			if _, isFile := tt.query.(*SqlFile); !isFile {
				if got.Build() != tt.query.Build() {
					t.Errorf("Build() mismatch:\n--- got ---\n%s\n--- want ---\n%s", got.Build(), tt.query.Build())
				}
			}
			if got.ShouldSkipFilters() != tt.query.ShouldSkipFilters() {
				t.Errorf("ShouldSkipFilters: got %v want %v", got.ShouldSkipFilters(), tt.query.ShouldSkipFilters())
			}
			if got.Database() != tt.query.Database() {
				t.Errorf("Database: got %q want %q", got.Database(), tt.query.Database())
			}
			// marshal-idempotence: re-marshalling the reconstructed queryable
			// yields byte-identical JSON.
			first, _ := MarshalQueryable(tt.query)
			second, _ := MarshalQueryable(got)
			if string(first) != string(second) {
				t.Errorf("re-marshal mismatch:\n--- first ---\n%s\n--- second ---\n%s", first, second)
			}
		})
	}
}

func TestQueryableConcreteTypesPreserved(t *testing.T) {
	if _, ok := roundTripQueryable(t, New(From("t"))).(*SqlQuery); !ok {
		t.Error("SqlQuery did not round-trip to *SqlQuery")
	}
	if _, ok := roundTripQueryable(t, FromFile("a.sql")).(*SqlFile); !ok {
		t.Error("SqlFile did not round-trip to *SqlFile")
	}
	if _, ok := roundTripQueryable(t, FromString("x {{DASHICA_FILTERS}}")).(*SqlString); !ok {
		t.Error("SqlString did not round-trip to *SqlString")
	}
}

func TestUnmarshalQueryableUnknownKind(t *testing.T) {
	_, err := UnmarshalQueryable([]byte(`{"kind":"banana"}`))
	if err == nil {
		t.Fatal("expected error for unknown queryable kind")
	}
}

// TestQueryableRoundTripThroughDashboardEnvelope exercises the case that matters
// in practice: a queryable nested inside a larger struct, marshalled via the
// standard encoding/json path (which dispatches to the concrete MarshalJSON).
func TestQueryableNestedMarshal(t *testing.T) {
	type widgetLike struct {
		Query json.RawMessage `json:"query"`
	}
	orig := New(From("full_logs"), Where("x = 1"))
	qb, err := MarshalQueryable(orig)
	if err != nil {
		t.Fatal(err)
	}
	wrapped, err := json.Marshal(widgetLike{Query: qb})
	if err != nil {
		t.Fatal(err)
	}
	var back widgetLike
	if err := json.Unmarshal(wrapped, &back); err != nil {
		t.Fatal(err)
	}
	got, err := UnmarshalQueryable(back.Query)
	if err != nil {
		t.Fatal(err)
	}
	if got.Build() != orig.Build() {
		t.Errorf("nested round-trip Build mismatch:\n%s\n---\n%s", got.Build(), orig.Build())
	}
}
