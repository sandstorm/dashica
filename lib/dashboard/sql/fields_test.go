// Tests for CountIf and Ratio: the measures of a time chart and of the alert on it.
package sql

import (
	"strings"
	"testing"
)

func TestCountIf_CountsTheRowsOfItsCondition(t *testing.T) {
	field := CountIf("level = 'error'")

	if field.Definition() != "countIf(level = 'error')" {
		t.Errorf("Definition() = %q", field.Definition())
	}
	if field.Alias() != "cnt" {
		t.Errorf("Alias() = %q, want cnt", field.Alias())
	}
	if IsCategory(field) {
		t.Error("a count is a measure, not a category")
	}
}

func TestRatio_IsNullWhenTheDenominatorIsZero(t *testing.T) {
	field := Ratio(CountIf("status >= 500"), Count())

	if field.Definition() != "countIf(status >= 500) / nullIf(count(*), 0)" {
		t.Errorf("Definition() = %q", field.Definition())
	}
	if field.Alias() != "ratio" {
		t.Errorf("Alias() = %q, want ratio", field.Alias())
	}
	if IsCategory(field) {
		t.Error("a ratio is a measure, not a category")
	}
}

func TestRatio_MinIsNullBelowTheMinimumDenominator(t *testing.T) {
	field := Ratio(CountIf("status >= 500"), Count()).Min(50).WithAlias("failure_rate")

	if field.Definition() != "if(count(*) < 50, NULL, countIf(status >= 500) / count(*))" {
		t.Errorf("Definition() = %q", field.Definition())
	}
	if field.Alias() != "failure_rate" {
		t.Errorf("Alias() = %q, want failure_rate", field.Alias())
	}
	if IsCategory(field) {
		t.Error("a ratio with a minimum and an alias is still a measure")
	}
}

func TestRatio_InATimeChartQuery(t *testing.T) {
	built := New(From("http_logs"), Select(Timestamp15Min()), Select(Ratio(CountIf("status >= 500"), Count())), GroupBy(Timestamp15Min())).Build()

	if !strings.Contains(built, "countIf(status >= 500) / nullIf(count(*), 0) AS ratio") {
		t.Errorf("built query lacks the ratio:\n%s", built)
	}
}
