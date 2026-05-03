package db_sampler

import (
	"bytes"
	"regexp"
	"strings"
	"testing"
)

func TestScrambleAlphanumericDeterministic(t *testing.T) {
	a := ScrambleAlphanumeric("alice@example.com")
	b := ScrambleAlphanumeric("alice@example.com")
	if a != b {
		t.Fatalf("not deterministic: %q vs %q", a, b)
	}
	if a == "alice@example.com" {
		t.Fatal("expected scrambled output to differ")
	}
	// Structure preserved: '@' and '.' kept in place
	if !strings.Contains(a, "@") || !strings.Contains(a, ".") {
		t.Fatalf("structure not preserved: %q", a)
	}
}

func TestScrambleIPv4(t *testing.T) {
	a := ScrambleIP("192.168.1.42")
	if a == "192.168.1.42" {
		t.Fatalf("ip not scrambled: %q", a)
	}
	parts := strings.Split(a, ".")
	if len(parts) != 4 {
		t.Fatalf("expected 4 octets: %q", a)
	}
	if ScrambleIP("0.0.0.0") != "0.0.0.0" {
		t.Fatal("zero ip should pass through")
	}
}

func TestStructuralColumns(t *testing.T) {
	p := StructuralColumns(map[string]ColumnRule{
		"email":      Action(ScrambleEmail),
		"ip":         Action(ScrambleIPAction),
		"user_agent": ReplaceWith("REDACTED"),
	})
	v, skip := p("Email", "alice@example.com") // case-insensitive match
	if skip {
		t.Fatal("should not skip")
	}
	if v.(string) == "alice@example.com" {
		t.Fatal("email not scrambled")
	}
	v, _ = p("user_agent", "Mozilla/5.0 ...")
	if v != "REDACTED" {
		t.Fatalf("user_agent: %v", v)
	}
	v, _ = p("other_col", "preserve me")
	if v != "preserve me" {
		t.Fatal("non-matching column should pass through")
	}
}

func TestTextRegexAndChain(t *testing.T) {
	p := Chain(
		TextRegex(regexp.MustCompile(`\b\d{3}-\d{4}\b`), "<PHONE>"),
		TextRegex(regexp.MustCompile(`secret`), "<S>"),
	)
	v, _ := p("msg", "call 555-1234 about secret stuff")
	got := v.(string)
	if !strings.Contains(got, "<PHONE>") || !strings.Contains(got, "<S>") {
		t.Fatalf("chain did not apply both: %q", got)
	}
}

func TestRedactHighEntropyTokens(t *testing.T) {
	p := RedactHighEntropyTokens(4.5, 12)
	hi := "header eyJhbGciOiJIUzI1NiJ9.aBcDeFgHiJkLmNoPqRsTuVwXyZ012345 trailing"
	v, _ := p("msg", hi)
	if !strings.Contains(v.(string), "<SECRET>") {
		t.Fatalf("expected high-entropy token redacted: %q", v)
	}
	if !strings.Contains(v.(string), "header") || !strings.Contains(v.(string), "trailing") {
		t.Fatalf("low-entropy tokens dropped: %q", v)
	}
}

func TestDropAndTruncateFields(t *testing.T) {
	p := Chain(DropFields("password"), TruncateFields("blob"))
	row := map[string]any{"keep": "x", "password": "hunter2", "blob": "huge"}
	out := AnonymizeRow(row, p)
	if _, ok := out["password"]; ok {
		t.Fatal("password not dropped")
	}
	if out["blob"] != "<TRUNCATED>" {
		t.Fatalf("blob: %v", out["blob"])
	}
	if out["keep"] != "x" {
		t.Fatal("keep mutated")
	}
}

func TestAnonymizeJSONLStream(t *testing.T) {
	p := TextRegex(regexp.MustCompile(`secret`), "<S>")
	in := strings.NewReader("{\"a\":\"the secret\"}\n\n{\"b\":\"plain\"}\n")
	var out bytes.Buffer
	if err := AnonymizeJSONLStream(in, &out, p); err != nil {
		t.Fatal(err)
	}
	got := out.String()
	if !strings.Contains(got, "<S>") || !strings.Contains(got, "plain") {
		t.Fatalf("unexpected: %q", got)
	}
}

func TestDefaultProcessorEndToEnd(t *testing.T) {
	p := DefaultProcessor()
	row := map[string]any{
		"email":      "alice@example.org",
		"ip":         "203.0.113.42",
		"user_agent": "Mozilla/5.0",
		"message":    "User bob@example.com from 10.0.0.5 logged in",
	}
	out := AnonymizeRow(row, p)
	if out["email"] == "alice@example.org" {
		t.Fatal("structural email not scrambled")
	}
	if out["user_agent"] != "REDACTED" {
		t.Fatalf("user_agent: %v", out["user_agent"])
	}
	msg := out["message"].(string)
	if strings.Contains(msg, "bob@example.com") {
		t.Fatalf("regex email leak: %q", msg)
	}
	if strings.Contains(msg, "10.0.0.5") {
		t.Fatalf("regex IP leak: %q", msg)
	}
}
