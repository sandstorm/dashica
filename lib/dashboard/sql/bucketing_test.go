package sql

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSqlQuery_AdjustBuckets_RebakesAutoBucketField(t *testing.T) {
	tests := []struct {
		name           string
		widthS         int64
		wantRoundingFn string
		wantSizeMs     int64
	}{
		// 1h = 3600s; toStartOfSecond would yield 3600 buckets (> 721) → fall through to toStartOfMinute (60 buckets).
		{name: "1 hour", widthS: 60 * 60, wantRoundingFn: "toStartOfMinute", wantSizeMs: 60 * 1000},
		// 1d: 86400 / toStartOfMinute (60s) = 1440 > 721; / toStartOfFiveMinutes (300s) = 288 ≤ 721 → 5min
		{name: "1 day", widthS: 24 * 60 * 60, wantRoundingFn: "toStartOfFiveMinutes", wantSizeMs: 5 * 60 * 1000},
		// 30d: 2592000 / toStartOfHour (3600) = 720 ≤ 721 → 1 hour
		{name: "30 days", widthS: 30 * 24 * 60 * 60, wantRoundingFn: "toStartOfHour", wantSizeMs: 60 * 60 * 1000},
		// 365d: falls past hour → toStartOfDay
		{name: "1 year", widthS: 365 * 24 * 60 * 60, wantRoundingFn: "toStartOfDay", wantSizeMs: 24 * 60 * 60 * 1000},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			q := New(
				Select(AutoBucket("timestamp")),
				Select(Count()),
				From("test_table"),
				GroupBy(AutoBucket("timestamp")),
			)

			adjusted, sizeMs := q.AdjustBuckets(tt.widthS)
			if sizeMs == nil {
				t.Fatal("expected non-nil bucket size")
			}
			if *sizeMs != tt.wantSizeMs {
				t.Errorf("size = %d ms, want %d ms", *sizeMs, tt.wantSizeMs)
			}

			built := adjusted.Build()
			wantExpr := tt.wantRoundingFn + "(timestamp)::DateTime64"
			if !strings.Contains(built, wantExpr) {
				t.Errorf("expected built SQL to contain %q, got:\n%s", wantExpr, built)
			}
			if strings.Contains(built, "toStartOfFifteenMinutes") && tt.wantRoundingFn != "toStartOfFifteenMinutes" {
				t.Errorf("expected default toStartOfFifteenMinutes to be replaced, got:\n%s", built)
			}
		})
	}
}

func TestSqlQuery_AdjustBuckets_NoOptInIsNoOp(t *testing.T) {
	q := New(
		Select(Timestamp15Min()), // fixed bucket, NOT AutoBucket — opted out
		Select(Count()),
		From("test_table"),
	)

	originalSql := q.Build()
	adjusted, sizeMs := q.AdjustBuckets(24 * 60 * 60)

	if sizeMs != nil {
		t.Errorf("expected nil size for query without AutoBucket, got %d ms", *sizeMs)
	}
	if adjusted.Build() != originalSql {
		t.Errorf("expected unchanged SQL, got different output")
	}
}

func TestSqlFile_AdjustBuckets_PlaceholderOptInSubstitutes(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "q.sql")
	content := "SELECT {{DASHICA_BUCKET}}(timestamp)::DateTime64 AS time FROM t WHERE {{DASHICA_FILTERS}}"
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}

	q := FromFile(path).With(AutoBucketPlaceholder())
	adjusted, sizeMs := q.AdjustBuckets(24 * 60 * 60) // expect 5min bucket

	if sizeMs == nil || *sizeMs != 5*60*1000 {
		t.Fatalf("expected 5min bucket size, got %v", sizeMs)
	}
	built := adjusted.Build()
	if !strings.Contains(built, "toStartOfFiveMinutes(timestamp)::DateTime64") {
		t.Errorf("expected substitution, got:\n%s", built)
	}
	if strings.Contains(built, "{{DASHICA_BUCKET}}") {
		t.Errorf("placeholder should be replaced, got:\n%s", built)
	}
}

func TestSqlFile_AdjustBuckets_NoOptInIsNoOp(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "q.sql")
	content := "SELECT * FROM t WHERE {{DASHICA_FILTERS}}"
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}

	q := FromFile(path) // no AutoBucketPlaceholder()
	_, sizeMs := q.AdjustBuckets(24 * 60 * 60)
	if sizeMs != nil {
		t.Errorf("expected nil size for SqlFile without opt-in, got %d", *sizeMs)
	}
}

func TestSqlFile_AdjustBuckets_PlaceholderWithoutOptInLeftLiteral(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "q.sql")
	content := "SELECT {{DASHICA_BUCKET}}(timestamp) FROM t WHERE {{DASHICA_FILTERS}}"
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}

	q := FromFile(path) // no opt-in
	adjusted, _ := q.AdjustBuckets(24 * 60 * 60)
	built := adjusted.Build()
	if !strings.Contains(built, "{{DASHICA_BUCKET}}") {
		t.Errorf("expected literal placeholder to remain (fail loud), got:\n%s", built)
	}
}

func TestBucketSelector_PicksSmallestFittingBucket(t *testing.T) {
	tests := []struct {
		widthS         int64
		wantRoundingFn string
		wantSizeS      int64
	}{
		{widthS: 60, wantRoundingFn: "toStartOfSecond", wantSizeS: 1},
		{widthS: 60 * 60, wantRoundingFn: "toStartOfMinute", wantSizeS: 60},
		{widthS: 24 * 60 * 60, wantRoundingFn: "toStartOfFiveMinutes", wantSizeS: 5 * 60},
		{widthS: 30 * 24 * 60 * 60, wantRoundingFn: "toStartOfHour", wantSizeS: 60 * 60},
	}
	for _, tt := range tests {
		fn, sizeS := bucketSelector(tt.widthS)
		if fn != tt.wantRoundingFn || sizeS != tt.wantSizeS {
			t.Errorf("widthS=%d: got (%q, %d), want (%q, %d)",
				tt.widthS, fn, sizeS, tt.wantRoundingFn, tt.wantSizeS)
		}
	}
}
