package sql

import (
	"strings"
	"testing"
)

func TestLimit(t *testing.T) {
	tests := []struct {
		name    string
		limit   int
		wantSQL string
	}{
		{
			name:    "with limit",
			limit:   100,
			wantSQL: "LIMIT 100",
		},
		{
			name:    "with zero limit",
			limit:   0,
			wantSQL: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			query := New(
				From("test_table"),
				Limit(tt.limit),
			)

			sql := query.Build()

			if tt.wantSQL != "" {
				if !strings.Contains(sql, tt.wantSQL) {
					t.Errorf("Expected SQL to contain %q, got:\n%s", tt.wantSQL, sql)
				}
			} else {
				if strings.Contains(sql, "LIMIT") {
					t.Errorf("Expected SQL to not contain LIMIT, got:\n%s", sql)
				}
			}
		})
	}
}

func TestLimitWithOtherClauses(t *testing.T) {
	query := New(
		From("users"),
		Where("active = true"),
		OrderBy(Field("created_at")),
		Limit(50),
	)

	sql := query.Build()

	// Check that LIMIT comes after ORDER BY
	orderByIdx := strings.Index(sql, "ORDER BY")
	limitIdx := strings.Index(sql, "LIMIT")

	if orderByIdx == -1 {
		t.Error("Expected ORDER BY clause in SQL")
	}
	if limitIdx == -1 {
		t.Error("Expected LIMIT clause in SQL")
	}
	if orderByIdx >= limitIdx {
		t.Errorf("Expected ORDER BY to come before LIMIT, got:\n%s", sql)
	}

	if !strings.Contains(sql, "LIMIT 50") {
		t.Errorf("Expected LIMIT 50, got:\n%s", sql)
	}
}

func TestLimitCanBeOverridden(t *testing.T) {
	query := New(
		From("products"),
		Limit(100),
	)

	// Override limit using With
	modifiedQuery := query.With(Limit(200))

	sql := modifiedQuery.Build()

	if !strings.Contains(sql, "LIMIT 200") {
		t.Errorf("Expected LIMIT 200 after override, got:\n%s", sql)
	}
	if strings.Contains(sql, "LIMIT 100") {
		t.Errorf("Expected old LIMIT 100 to be overridden, got:\n%s", sql)
	}
}

func TestLimitZeroRemovesLimit(t *testing.T) {
	query := New(
		From("orders"),
		Limit(100),
	)

	// Remove limit by setting to 0
	modifiedQuery := query.With(Limit(0))

	sql := modifiedQuery.Build()

	if strings.Contains(sql, "LIMIT") {
		t.Errorf("Expected no LIMIT clause when set to 0, got:\n%s", sql)
	}
}

func TestWithFill(t *testing.T) {
	query := New(
		From("metrics"),
		Select(Field("user")),
		Select(Field("max(pct)").WithAlias("pct")),
		GroupBy(Field("user")),
		OrderBy(Field("user")),
		OrderBy(Field("time")),
		WithFill("toIntervalHour(1)"),
	)

	sql := query.Build()

	// WITH FILL must attach to the LAST ORDER BY column (time), not the first.
	want := "time WITH FILL STEP toIntervalHour(1)"
	if !strings.Contains(sql, want) {
		t.Errorf("Expected SQL to contain %q, got:\n%s", want, sql)
	}
	if strings.Contains(sql, "user WITH FILL") {
		t.Errorf("WITH FILL must not attach to partition column 'user', got:\n%s", sql)
	}
}

func TestWithoutFill(t *testing.T) {
	query := New(
		From("metrics"),
		OrderBy(Field("time")),
	)
	if strings.Contains(query.Build(), "WITH FILL") {
		t.Errorf("Expected no WITH FILL when WithFill not set, got:\n%s", query.Build())
	}
}
