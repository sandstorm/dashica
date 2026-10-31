// Package filter is the pills of a page (`?f=<key>`): a condition on a table that the server wrote from a chart's
// field (New) or for a filter button of the page (NewButton) and signed (Sign), opened again on every request (Open)
// and applied by every chart on that table, a button's by every query that takes filters (Apply); and Diagnostics,
// what a chart tells the outside about one answer. See docs/2026-10-28-workbench.md §3.8.
package filter

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/sandstorm/dashica/lib/dashboard/sql"
)

// Diagnostics is what a chart tells the outside about one answer, sent with its data (X-Dashica-Diagnostics).
type Diagnostics struct {
	// Ignored are the labels of the pills the chart does not apply ("customer = acme"), each once, in URL order.
	Ignored []string `json:"ignored,omitempty"`
	// Skipped is non-empty when the chart did not run, and says why.
	Skipped string `json:"skipped,omitempty"`
}

// Table is a table as pills name it: its ClickHouse connection and its name with the database ("default",
// "monitoring.full_logs"), so that `full_logs` and `monitoring.full_logs` on a connection to `monitoring` are one.
type Table struct {
	Connection string `json:"connection"`
	Name       string `json:"table"`
}

// TableOf is the Table whose pills `q` takes (sql.TableOf: a builder query's From, a SQL file's sql.Table) on its
// connection ("default" when it names none), a name without database in `database(connection)`, the connection's
// database from dashica_config; false for a query without one, and for one that skips filters.
func TableOf(q sql.SqlQueryable, database func(connection string) string) (Table, bool) {
	name, ok := sql.TableOf(q)
	if !ok || q.ShouldSkipFilters() {
		return Table{}, false
	}
	connection := sql.ConnectionOf(q)
	if db := database(connection); !strings.Contains(name, ".") && db != "" {
		name = db + "." + name
	}
	return Table{Connection: connection, Name: name}, true
}

// Pill is a filter on a table: the rows where a field shows a value (`eq`) or does not (`ne`), as the condition the
// server wrote for it; or a filter button's condition (Button), on no table. Its key (Sign) carries all of it, signed.
type Pill struct {
	Table
	// Field is the alias of the field it filters by ("customer"); the pills on one table and field combine (Apply).
	Field string `json:"field"`
	// Op is `eq` or `ne`.
	Op string `json:"op"`
	// Condition is what goes into the WHERE of a chart on Table (`customer_project = 'customer-acme'`).
	Condition string `json:"condition"`
	// Label is the chip's text: "customer = acme", "customer ≠ acme"; a button's title, with its value after a colon
	// ("Duration >= … ms: 500").
	Label string `json:"label"`
	// Button is the condition of the filter button the pill was made for, as the dashboard declares it
	// ("duration_ms >= ..."), by which the page finds its button; empty for a field's pill. A button's pill has no
	// table, field or op.
	Button string `json:"button,omitempty"`
	// Value is the value the field shows ("acme"), by which the filter bar edits the pill (a new op or value asks the
	// field's chart for a new one), always in the key, empty ones too, so a key signed before pills carried it
	// (without "value") reads as not editable; for a button, the value written in for its `...` ("500"), as typed,
	// empty for one without.
	Value string `json:"value"`
}

// ErrCannotFilter: the field holds no categories (a count, a time bucket), so it makes no pill.
var ErrCannotFilter = errors.New("cannot filter")

// New is the pill on `table` of the rows where `field` shows `value` (`op` `eq`) or does not (`ne`): its condition as
// sql.Condition writes it (the field's FilterAs, else its definition compared with the quoted value), labelled with
// the field's alias; the alias and `value` in it too, so the filter bar can make it again with another op or value.
// ErrCannotFilter for a field that cannot filter.
func New(table Table, field sql.SqlField, op, value string) (Pill, error) {
	if op != "eq" && op != "ne" {
		return Pill{}, fmt.Errorf("op %q: want eq or ne", op)
	}
	condition, ok := sql.Condition(field, value, op == "ne")
	if !ok {
		return Pill{}, ErrCannotFilter
	}
	sign := " = "
	if op == "ne" {
		sign = " ≠ "
	}
	return Pill{Table: table, Field: field.Alias(), Op: op, Condition: condition, Label: field.Alias() + sign + value, Value: value}, nil
}

// NewButton is the pill of the filter button `title` with the condition `queryPart`: `queryPart` itself, or for a
// button with `...` in it ("duration_ms >= ...") each `...` replaced by `value` as a string literal (sql.Quote:
// `duration_ms >= '500'`), so a typed value never becomes SQL. An error for a value on a button without `...`, and
// for an empty one on a button with.
func NewButton(title, queryPart, value string) (Pill, error) {
	if !strings.Contains(queryPart, "...") {
		if value != "" {
			return Pill{}, fmt.Errorf("filter button %q takes no value", title)
		}
		return Pill{Condition: queryPart, Label: title, Button: queryPart}, nil
	}
	if value == "" {
		return Pill{}, fmt.Errorf("filter button %q needs a value", title)
	}
	condition := strings.ReplaceAll(queryPart, "...", sql.Quote(value))
	return Pill{Condition: condition, Label: title + ": " + value, Button: queryPart, Value: value}, nil
}

// Sign is the key of `p`, what the URL holds (`?f=<key>`): `<payload>.<mac>`, the payload `p` as JSON and the mac its
// HMAC-SHA256 with `secret` (filters.secret), each in unpadded base64url. The client reads the label from the payload.
func Sign(secret []byte, p Pill) (string, error) {
	if len(secret) == 0 {
		return "", errors.New("filters.secret is not set")
	}
	b, err := json.Marshal(p)
	if err != nil {
		return "", err
	}
	payload := base64.RawURLEncoding.EncodeToString(b)
	return payload + "." + base64.RawURLEncoding.EncodeToString(mac(secret, payload)), nil
}

// Open is the pill of `key` (Sign), when its mac is the one `secret` gives; else an error: a key changed on its way, one
// written by hand, one signed with another secret.
func Open(secret []byte, key string) (Pill, error) {
	if len(secret) == 0 {
		return Pill{}, errors.New("filters.secret is not set")
	}
	payload, signature, ok := strings.Cut(key, ".")
	got, err := base64.RawURLEncoding.DecodeString(signature)
	if !ok || err != nil || !hmac.Equal(got, mac(secret, payload)) {
		return Pill{}, fmt.Errorf("pill %q: not signed by this server", shorten(key))
	}
	b, err := base64.RawURLEncoding.DecodeString(payload)
	var p Pill
	if err == nil {
		err = json.Unmarshal(b, &p)
	}
	if err != nil || p.Condition == "" || (p.Button == "" && p.Op != "eq" && p.Op != "ne") {
		return Pill{}, fmt.Errorf("pill %q: unreadable", shorten(key))
	}
	return p, nil
}

func mac(secret []byte, payload string) []byte {
	h := hmac.New(sha256.New, secret)
	h.Write([]byte(payload))
	return h.Sum(nil)
}

// shorten is a key as an error names it: its first 24 characters.
func shorten(key string) string {
	if len(key) <= 24 {
		return key
	}
	return key[:24] + "…"
}

// Apply is `q` with the pills on `table` added to its WHERE (a SQL file's {{DASHICA_FILTERS}}), and the Diagnostics
// naming the others; without a table (`ok` false, TableOf) it applies none. The pills on one field combine, in the
// order of their first one: the `eq` ones OR-ed (`customer = acme` or `customer = globex`), the `ne` ones AND-ed; each
// combination one Where. A button's pill applies to every query that takes filters, a SQL file without sql.Table
// too, each one Where after those of the fields.
func Apply(q sql.SqlQueryable, table Table, ok bool, pills []Pill) (sql.SqlQueryable, Diagnostics) {
	var d Diagnostics
	type group struct{ field, op string }
	var order []group
	conditions := map[group][]string{}
	var buttons []sql.SqlBuilderOption
	for _, p := range pills {
		if p.Button != "" && !q.ShouldSkipFilters() {
			buttons = append(buttons, sql.Where(p.Condition))
			continue
		}
		if !ok || p.Button != "" || p.Table != table {
			if !slices.Contains(d.Ignored, p.Label) {
				d.Ignored = append(d.Ignored, p.Label)
			}
			continue
		}
		g := group{p.Field, p.Op}
		if _, seen := conditions[g]; !seen {
			order = append(order, g)
		}
		conditions[g] = append(conditions[g], "("+p.Condition+")")
	}
	var wheres []sql.SqlBuilderOption
	for _, g := range order {
		join := " OR "
		if g.op == "ne" {
			join = " AND "
		}
		wheres = append(wheres, sql.Where(strings.Join(conditions[g], join)))
	}
	wheres = append(wheres, buttons...)
	if len(wheres) > 0 {
		q = q.With(wheres...)
	}
	return q, d
}
