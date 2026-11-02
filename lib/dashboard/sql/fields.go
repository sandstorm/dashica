package sql

import (
	"fmt"
	"regexp"
	"strings"
)

// AutoBucket declares a time bucket whose granularity follows the user's
// time-range filter. The chosen ClickHouse rounding function
// (toStartOfMinute, toStartOfHour, ...) is selected at request time based on
// the resolved time range.
//
// Use AutoBucket when you want the bucket size to follow the time range. Use
// Timestamp15Min / Timestamp5Min / TimestampField for a fixed bucket size.
//
// The alias defaults to "time"; use AutoBucketAs for a different alias.
func AutoBucket(column string) TimestampedField {
	return AutoBucketAs(column, "time")
}

// AutoBucketAs is AutoBucket with an explicit alias.
func AutoBucketAs(column, alias string) TimestampedField {
	return &autoBucketFieldImpl{
		column_:    column,
		alias_:     alias,
		definition: fmt.Sprintf("%s(%s)::DateTime64", defaultAutoBucketRounding, column),
		sizeMs:     defaultAutoBucketSizeMs,
	}
}

func Timestamp15Min() TimestampedField {
	return &fieldImpl{
		definition:              "toStartOfFifteenMinutes(timestamp)::DateTime64",
		alias:                   "time",
		timestamp_xBucketSizeMs: 15 * 60 * 1000,
	}
}

func Timestamp5Min() TimestampedField {
	return &fieldImpl{
		definition:              "toStartOfInterval(timestamp, INTERVAL 5 MINUTE)::DateTime64",
		alias:                   "time",
		timestamp_xBucketSizeMs: 5 * 60 * 1000,
	}
}

// TimestampField builds a custom time-bucket field. Use the predefined Timestamp* helpers when possible.
func TimestampField(definition, alias string, xBucketSizeMs int64) TimestampedField {
	return &fieldImpl{
		definition:              definition,
		alias:                   alias,
		timestamp_xBucketSizeMs: xBucketSizeMs,
	}
}

func NewFieldAlias(alias string) TimestampedField {
	return &fieldImpl{
		definition: alias,
		alias:      alias,
	}
}

func NewTimestampedFieldAlias(alias string, xBucketSizeMs int64) TimestampedField {
	return &fieldImpl{
		definition:              alias,
		alias:                   alias,
		timestamp_xBucketSizeMs: xBucketSizeMs,
	}
}

func JsonExtractString(jsonStrField string, paths ...string) SqlField {
	quotedPaths := make([]string, len(paths))
	for i, path := range paths {
		quotedPaths[i] = fmt.Sprintf("'%s'", path)
	}

	return &fieldImpl{
		definition: fmt.Sprintf("JSONExtractString(%s, %s)", jsonStrField, strings.Join(quotedPaths, ", ")),
		alias:      paths[len(paths)-1],
	}
}

func Count() SqlField {
	return &fieldImpl{
		kind:       kindCount,
		definition: "count(*)",
		alias:      "cnt",
	}
}

// CountIf counts the rows of `condition` (`level = 'error'`): a count like Count(), for one series of a chart whose
// base query reads all rows.
func CountIf(condition string) SqlField {
	return &fieldImpl{
		kind:       kindCount,
		definition: fmt.Sprintf("countIf(%s)", condition),
		alias:      "cnt",
	}
}

// RatioField is the quotient of two measures, a measure itself: NULL where the denominator is 0 (a time bucket without
// rows has no ratio) or below Min.
type RatioField struct {
	*fieldImpl
	numerator, denominator SqlField
}

// Ratio is `numerator / denominator` (`sql.Ratio(sql.CountIf("status >= 500"), sql.Count())`).
func Ratio(numerator, denominator SqlField) *RatioField {
	return &RatioField{
		fieldImpl: &fieldImpl{
			kind:       kindExpr,
			definition: fmt.Sprintf("%s / nullIf(%s, 0)", numerator.Definition(), denominator.Definition()),
			alias:      "ratio",
		},
		numerator:   numerator,
		denominator: denominator,
	}
}

// Min is the ratio NULL where the denominator is below `minimum`: no failure rate of 3 orders.
func (r *RatioField) Min(minimum int64) *RatioField {
	return r.with(func(f *fieldImpl) {
		f.definition = fmt.Sprintf("if(%s < %d, NULL, %s / %s)", r.denominator.Definition(), minimum, r.numerator.Definition(), r.denominator.Definition())
	})
}

func (r *RatioField) WithAlias(s string) SqlField {
	return r.with(func(f *fieldImpl) { f.alias = s })
}

func (r *RatioField) with(change func(f *fieldImpl)) *RatioField {
	field := *r.fieldImpl
	change(&field)
	return &RatioField{fieldImpl: &field, numerator: r.numerator, denominator: r.denominator}
}

func Enum(field string) SqlField {
	return &fieldImpl{
		kind:       kindEnum,
		definition: fmt.Sprintf("%s::String", field),
		alias:      field,
	}
}

// IsCategory is whether `f` holds categories a chart can be filtered by: a column, an Enum or an expression
// (`JSONExtractString(attrs, 'host')`); a count and a Ratio are measures, a time bucket (Timestamp15Min, TimestampField,
// AutoBucket) a time axis, a constant (`sql.Field("'darkred'")`, a fixed colour of a Fill) the same on every row.
func IsCategory(f SqlField) bool {
	switch field := f.(type) {
	case autoBucketField, *RatioField:
		return false
	case *fieldImpl:
		return field.kind != kindCount && field.timestamp_xBucketSizeMs == 0 && !literal.MatchString(field.definition)
	}
	return true
}

// IsConstantColumn is whether `sqlText` (a SQL file's or string's query) selects a lone literal as the column `column`
// of its result (`'darkred' AS color`), in one of its SELECTs: a fixed colour or label, which filters nothing. It
// matches the text with a regular expression.
func IsConstantColumn(sqlText, column string) bool {
	constant := regexp.MustCompile(`(?i)(?:^|[\s,])(?:'(?:[^'\\]|\\.)*'|-?[0-9]+(?:\.[0-9]+)?)\s+AS\s+` + "`?" + regexp.QuoteMeta(column) + "`?" + `(?:[\s,]|$)`)
	return constant.MatchString(sqlText)
}

// ColumnOf is the column of its table `f` is (`sql.Field("host_name")`): a plain name, its own alias, without
// FilterAs; false for an expression, a field renamed with WithAlias, a count, a time bucket, a constant. "Add filter"
// lists such a field among its table's columns.
func ColumnOf(f SqlField) (string, bool) {
	own, ok := f.(*fieldImpl)
	if !ok || own.filterAs != nil || own.alias != own.definition || !IsCategory(f) || !identifier.MatchString(own.definition) {
		return "", false
	}
	return own.definition, true
}

// ColumnField is the field of the column `name` of a table, its name quoted (QuoteIdentifier) and its alias: the
// field of a pill on a table's column, whose condition is "(`host`) = 'shop-1'".
func ColumnField(name string) SqlField {
	return Field(QuoteIdentifier(name)).WithAlias(name)
}

// Condition is the WHERE condition of a pill on `f`: the rows where `f` compares by `op` with `value`. By default
// `(<definition>) <op> <quoted value>` (Op.Compare); a field with FilterAs its condition. False for a field that cannot
// filter (IsCategory).
func Condition(f SqlField, op Op, value string) (string, bool) {
	if f == nil || !IsCategory(f) {
		return "", false
	}
	if own, ok := f.(*fieldImpl); ok && own.filterAs != nil {
		return own.filterAs(op, value), true
	}
	return op.Compare("("+f.Definition()+")", value), true
}

// Quote is `value` as a ClickHouse string literal: in single quotes, each `\` and `'` escaped with a backslash
// (`it's` is `'it\'s'`), so it never ends the literal.
func Quote(value string) string {
	return "'" + strings.NewReplacer(`\`, `\\`, `'`, `\'`).Replace(value) + "'"
}

// QuoteIdentifier is `name` as a ClickHouse identifier: in backticks, each `\` and backtick escaped with a backslash,
// so a column name from the schema never ends it.
func QuoteIdentifier(name string) string {
	return "`" + strings.NewReplacer(`\`, `\\`, "`", "\\`").Replace(name) + "`"
}

// defaultAutoBucketRounding is the rounding function applied to AutoBucket
// fields before AdjustBuckets has run (e.g. in tests, HandleDebug, or any
// path that calls Build() without first attaching a time range). 15-minute
// keeps Build() output valid SQL.
const defaultAutoBucketRounding = "toStartOfFifteenMinutes"
const defaultAutoBucketSizeMs = 15 * 60 * 1000

type autoBucketFieldImpl struct {
	column_    string
	alias_     string
	definition string
	sizeMs     int64
}

func (f *autoBucketFieldImpl) Definition() string   { return f.definition }
func (f *autoBucketFieldImpl) Alias() string        { return f.alias_ }
func (f *autoBucketFieldImpl) XBucketSizeMs() int64 { return f.sizeMs }
func (f *autoBucketFieldImpl) column() string       { return f.column_ }

func (f *autoBucketFieldImpl) WithAlias(s string) SqlField {
	cloned := *f
	cloned.alias_ = s
	return &cloned
}

// FilterAs is the bucket itself: a time bucket filters nothing.
func (f *autoBucketFieldImpl) FilterAs(func(op Op, value string) string) SqlField { return f }

func (f *autoBucketFieldImpl) withRounding(roundingFn string, sizeMs int64) autoBucketField {
	cloned := *f
	cloned.definition = fmt.Sprintf("%s(%s)::DateTime64", roundingFn, f.column_)
	cloned.sizeMs = sizeMs
	return &cloned
}

var _ autoBucketField = (*autoBucketFieldImpl)(nil)

// literal is a lone SQL string or number literal: `'darkred'`, `'#D73027'`, `42`, `-0.5`.
var literal = regexp.MustCompile(`^\s*(?:'(?:[^'\\]|\\.)*'|-?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)\s*$`)

// identifier is a plain column name.
var identifier = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
