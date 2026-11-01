// Package filter is the pills of a page (`?f=<key>`): a condition on a table that the server wrote from a chart's
// field (New) or for a filter button of the page (NewButton) and signed (FilterService.Sign), opened again on every
// request (FilterService.Open) and applied by every chart on that table, a button's by every query that takes filters
// (Apply); and Diagnostics, what a chart tells the outside about one answer. See docs/2026-10-28-workbench.md §3.8.
package filter

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"slices"
	"strings"

	"github.com/sandstorm/dashica/lib/config"
	"github.com/sandstorm/dashica/lib/dashboard/sql"
)

// FilterService signs and opens the server's pills and names their tables, with what dashica_config says for them:
// filters.secret, the key of each pill's HMAC, and each connection's database (`clickhouse.<name>.database`), where a
// table named without its database is. One for the server, in rendering.Dependencies.
type FilterService struct {
	config *config.Config
}

// NewFilterService is the FilterService of `cfg`, the loaded dashica_config.
func NewFilterService(cfg *config.Config) *FilterService {
	return &FilterService{config: cfg}
}

// database is the database dashica_config names for `connection` ("" for one it does not know).
func (s *FilterService) database(connection string) string {
	return s.config.ClickHouse[connection].Database
}

// secret is filters.secret, the key of each pill's HMAC.
func (s *FilterService) secret() []byte {
	return []byte(s.config.Filters.Secret)
}

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
	Connection string
	Name       string
}

// TableOf is the Table whose pills `q` takes (sql.TableOf: a builder query's From, a SQL file's sql.Table) on its
// connection ("default" when it names none), a name without database in the connection's database from
// dashica_config; false for a query without one, and for one that skips filters.
func (s *FilterService) TableOf(q sql.SqlQueryable) (Table, bool) {
	name, ok := sql.TableOf(q)
	if !ok || q.ShouldSkipFilters() {
		return Table{}, false
	}
	connection := sql.ConnectionOf(q)
	if db := s.database(connection); !strings.Contains(name, ".") && db != "" {
		name = db + "." + name
	}
	return Table{Connection: connection, Name: name}, true
}

// Pill is a filter on a table: the rows where a field compares by an op with a value (`customer = acme`, `timestamp ≥
// 2026-10-31T10:00:00.000Z`), as the condition the server wrote for it; or a filter button's condition (Button), on
// no table. Its key (FilterService.Sign) carries it, signed.
type Pill struct {
	Table
	// Field is the alias of the field it filters by ("customer"), or with Column the column's name; the pills on one
	// table, field and Column combine (Apply).
	Field string
	// Column is set for a pill on a column of the table, whose Condition is the column's own (`(`host`) = 'web-1'`,
	// sql.ColumnField; "Add filter"'s table columns and a click on a field that is just a column,
	// docs/2026-10-28-workbench.md §3.15 D27, D29), which any chart on the table makes again; else a chart's field's,
	// which a chart with that field makes. Its key carries no condition.
	Column bool
	// Op is how the field compares with Value (sql.Op: `eq`, `ne`, `lt`, `le`, `gt`, `ge`).
	Op sql.Op
	// Condition is what goes into the WHERE of a chart on Table (`customer_project = 'customer-acme'`).
	Condition string
	// Label is the chip's text, made from the rest and not in the key: "customer = acme", "customer ≠ acme",
	// "duration_ms ≥ 500"; a button's its condition (`duration_ms >= '500'`; NewButton: its title, with its value
	// after a colon, "Duration >= … ms: 500").
	Label string
	// Button is the condition of the filter button the pill was made for, as the dashboard declares it
	// ("duration_ms >= ..."), by which the page finds its button; empty for a field's pill. A button's pill has no
	// table, field or op.
	Button string
	// Value is the value the field shows ("acme"), by which the filter bar edits the pill (a new op or value asks the
	// field's chart for a new one); for a button, the value written in for its `...` ("500"), as typed, empty for one
	// without.
	Value string
}

// ErrCannotFilter: the field holds no categories (a count, a time bucket), so it makes no pill.
var ErrCannotFilter = errors.New("cannot filter")

// New is the pill on `table` of the rows where `field` compares by `op` with `value`: its condition as sql.Condition
// writes it (the field's FilterAs, else its definition compared with the quoted value), a Column when that is the
// condition of the column the alias names (sql.ColumnField); labelled with the field's alias and the op's sign
// ("duration_ms ≥ 500"); the alias and `value` in it too, so the filter bar can make it again with another op or
// value. ErrCannotFilter for a field that cannot filter.
func New(table Table, field sql.SqlField, op sql.Op, value string) (Pill, error) {
	if !op.Valid() {
		return Pill{}, fmt.Errorf("op %q: want eq, ne, lt, le, gt or ge", op)
	}
	condition, ok := sql.Condition(field, op, value)
	if !ok {
		return Pill{}, ErrCannotFilter
	}
	p := Pill{Table: table, Field: field.Alias(), Op: op, Condition: condition, Value: value}
	p.Column = condition == columnCondition(p)
	p.Label = fieldLabel(p)
	return p, nil
}

// columnCondition is the condition of a pill on the column `p.Field` (sql.ColumnField): what Open writes for a key
// without one.
func columnCondition(p Pill) string {
	condition, _ := sql.Condition(sql.ColumnField(p.Field), p.Op, p.Value)
	return condition
}

func fieldLabel(p Pill) string {
	return p.Field + " " + p.Op.Sign() + " " + p.Value
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

// Sign is the key of `p`, what the URL holds (`?f=<key>`, docs/2026-10-28-workbench.md §3.15 D29), readable and short:
//
//	<table>.<field><op><value>[~<condition>]~<mac>    mv_oekokiste_shop.host=web-1~Zp8x…
//	@<button>[~<value>]~<mac>                         @duration_ms >= ...~500~kq3V…
//
// The table is `[<connection>:][<database>.]<name>`, the connection left out when it is "default" and the database
// when it is the connection's (dashica_config); the op its ClickHouse
// operator (`=`, `!=`, `<`, `<=`, `>`, `>=`); the condition only when it is not the column's own (a Column's). The mac
// is the HMAC-SHA256 with filters.secret of everything before it, its first 128 bits in unpadded base64url.
// `%` and each separator a part could hold are percent-encoded in it (`~` everywhere; `:`, `.`, `=`, `!`, `<`, `>`
// and `@` in a name; a value's leading `=`), so each part reads back as it was.
func (s *FilterService) Sign(p Pill) (string, error) {
	secret := s.secret()
	if len(secret) == 0 {
		return "", errors.New("filters.secret is not set")
	}
	var head string
	if p.Button != "" {
		head = "@" + escape(p.Button, "~")
		if p.Value != "" {
			head += "~" + escape(p.Value, "~")
		}
	} else {
		head = s.tableKey(p.Table) + "." + escape(p.Field, nameSeparators) + p.Op.Operator() + escapeValue(p.Value)
		if p.Condition != columnCondition(p) {
			head += "~" + escape(p.Condition, "~")
		}
	}
	return head + "~" + base64.RawURLEncoding.EncodeToString(mac(secret, head)), nil
}

// Open is the pill of `key` (Sign), when its mac is the one filters.secret gives, its table's name with the database
// dashica_config names for its connection when the key has none; else an error: a key changed on its way, one written
// by hand, one signed with another secret.
func (s *FilterService) Open(key string) (Pill, error) {
	secret := s.secret()
	if len(secret) == 0 {
		return Pill{}, errors.New("filters.secret is not set")
	}
	i := strings.LastIndex(key, "~")
	if i < 0 {
		return Pill{}, fmt.Errorf("pill %q: not signed by this server", shorten(key))
	}
	head := key[:i]
	got, err := base64.RawURLEncoding.DecodeString(key[i+1:])
	if err != nil || !hmac.Equal(got, mac(secret, head)) {
		return Pill{}, fmt.Errorf("pill %q: not signed by this server", shorten(key))
	}
	p, err := s.read(head)
	if err != nil {
		return Pill{}, fmt.Errorf("pill %q: unreadable", shorten(key))
	}
	return p, nil
}

// nameSeparators are the separators a name in a key escapes.
const nameSeparators = "~:.=!<>@"

// ops are the ops by their ClickHouse operator, the two-character ones first, as read reads them.
var ops = []sql.Op{sql.OpNe, sql.OpLe, sql.OpGe, sql.OpEq, sql.OpLt, sql.OpGt}

// read is the pill of a key's `head` (Sign: all before the mac).
func (s *FilterService) read(head string) (Pill, error) {
	parts := strings.Split(head, "~")
	if len(parts) > 2 {
		return Pill{}, errors.New("too many parts")
	}
	for i := range parts {
		var err error
		if i > 0 || strings.HasPrefix(head, "@") {
			if parts[i], err = url.PathUnescape(parts[i]); err != nil {
				return Pill{}, err
			}
		}
	}
	if button, ok := strings.CutPrefix(parts[0], "@"); ok {
		value := ""
		if len(parts) == 2 {
			value = parts[1]
		}
		p, err := NewButton("", button, value)
		if err != nil {
			return Pill{}, err
		}
		p.Label = p.Condition
		return p, nil
	}
	at := strings.IndexAny(parts[0], "=!<>")
	if at < 0 {
		return Pill{}, errors.New("no op")
	}
	i := slices.IndexFunc(ops, func(op sql.Op) bool { return strings.HasPrefix(parts[0][at:], op.Operator()) })
	if i < 0 {
		return Pill{}, errors.New("no op")
	}
	names, value := parts[0][:at], parts[0][at+len(ops[i].Operator()):]
	dot := strings.LastIndex(names, ".")
	if dot < 0 {
		return Pill{}, errors.New("no field")
	}
	table, err := s.readTable(names[:dot])
	if err != nil {
		return Pill{}, err
	}
	p := Pill{Table: table, Op: ops[i]}
	if p.Field, err = url.PathUnescape(names[dot+1:]); err != nil {
		return Pill{}, err
	}
	if p.Value, err = url.PathUnescape(value); err != nil {
		return Pill{}, err
	}
	p.Condition, p.Column = columnCondition(p), true
	if len(parts) == 2 {
		p.Condition, p.Column = parts[1], false
	}
	if p.Field == "" || p.Condition == "" {
		return Pill{}, errors.New("no field")
	}
	p.Label = fieldLabel(p)
	return p, nil
}

// tableKey is `t` as a key names it (Sign).
func (s *FilterService) tableKey(t Table) string {
	key := ""
	if t.Connection != "default" {
		key = escape(t.Connection, nameSeparators) + ":"
	}
	db, name, ok := strings.Cut(s.TableName(t), ".")
	if !ok {
		return key + escape(db, nameSeparators)
	}
	return key + escape(db, nameSeparators) + "." + escape(name, nameSeparators)
}

// readTable is the table a key names (tableKey).
func (s *FilterService) readTable(key string) (Table, error) {
	t := Table{Connection: "default"}
	if connection, rest, ok := strings.Cut(key, ":"); ok {
		t.Connection, key = connection, rest
	}
	parts := strings.Split(key, ".")
	if len(parts) > 2 || key == "" {
		return Table{}, errors.New("no table")
	}
	var err error
	if t.Connection, err = url.PathUnescape(t.Connection); err != nil {
		return Table{}, err
	}
	for i := range parts {
		if parts[i], err = url.PathUnescape(parts[i]); err != nil {
			return Table{}, err
		}
	}
	t.Name = strings.Join(parts, ".")
	if db := s.database(t.Connection); len(parts) == 1 && db != "" {
		t.Name = db + "." + t.Name
	}
	return t, nil
}

// TableName is the name of `t` as a key and page.json name it: without its database when that is the one
// dashica_config names for its connection (`http_logs` for `default.http_logs` on a connection to `default`), else
// with it.
func (s *FilterService) TableName(t Table) string {
	if db := s.database(t.Connection); db != "" {
		if name, ok := strings.CutPrefix(t.Name, db+"."); ok {
			return name
		}
	}
	return t.Name
}

// escape is `s` with `%` and each byte of `separators` percent-encoded (`~` as `%7E`).
func escape(s, separators string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		if c := s[i]; c == '%' || strings.IndexByte(separators, c) >= 0 {
			fmt.Fprintf(&b, "%%%02X", c)
		} else {
			b.WriteByte(c)
		}
	}
	return b.String()
}

// escapeValue is a value as a key holds it after its op: `~` and a leading `=` percent-encoded too, so that `<` with
// `=5` does not read as `<=` with `5`.
func escapeValue(value string) string {
	escaped := escape(value, "~")
	if strings.HasPrefix(escaped, "=") {
		return "%3D" + escaped[1:]
	}
	return escaped
}

// mac is the HMAC-SHA256 of `head` with `secret`, its first 128 bits.
func mac(secret []byte, head string) []byte {
	h := hmac.New(sha256.New, secret)
	h.Write([]byte(head))
	return h.Sum(nil)[:16]
}

// shorten is a key as an error names it: its first 24 characters.
func shorten(key string) string {
	if len(key) <= 24 {
		return key
	}
	return key[:24] + "…"
}

// Apply is `q` with the pills on `table` added to its WHERE (a SQL file's {{DASHICA_FILTERS}}), and the Diagnostics
// naming the others; without a table (`ok` false, FilterService.TableOf) it applies none. The pills on one field
// combine (a column and a computed field of the same name being two fields, Pill.Column), in the order of their first
// one: the `eq` ones OR-ed (`customer = acme` or `customer = globex`), those of each other op AND-ed (`customer ≠ acme`
// and `customer ≠ globex`; `timestamp ≥ a` and `timestamp ≥ b`); each combination one Where, so a `≥` and a `≤` on one
// field make a range. A button's pill applies to every query that takes filters, a SQL file without sql.Table too, each
// one Where after those of the fields.
func Apply(q sql.SqlQueryable, table Table, ok bool, pills []Pill) (sql.SqlQueryable, Diagnostics) {
	var d Diagnostics
	type group struct {
		field  string
		column bool
		op     sql.Op
	}
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
		g := group{p.Field, p.Column, p.Op}
		if _, seen := conditions[g]; !seen {
			order = append(order, g)
		}
		conditions[g] = append(conditions[g], "("+p.Condition+")")
	}
	var wheres []sql.SqlBuilderOption
	for _, g := range order {
		join := " AND "
		if g.op == sql.OpEq {
			join = " OR "
		}
		wheres = append(wheres, sql.Where(strings.Join(conditions[g], join)))
	}
	wheres = append(wheres, buttons...)
	if len(wheres) > 0 {
		q = q.With(wheres...)
	}
	return q, d
}
