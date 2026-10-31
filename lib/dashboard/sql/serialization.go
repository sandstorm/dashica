package sql

import (
	"bytes"
	"encoding/json"
	"fmt"
)

// This file makes the sql vocabulary serializable for the Explore builder
// (see docs/2026-07-21-dynamic-widget-dashboard-ui.md, section 4.1 (2)).
//
// The sql types keep unexported fields; serialization is added *around* them
// via small private DTO structs and a tagged-union wire format:
//   - SqlField  -> {"kind": "expr"|"count"|"enum"|"autoBucket", ...}
//   - SqlQueryable -> {"kind": "table"|"file"|"raw", ...}
//
// The "kind" discriminator lets UnmarshalField/UnmarshalQueryable pick the
// concrete type. These serializers are hand-written (a deliberate exception to
// the "derive everything" rule): the sql vocabulary is small and stable, and
// the round-trip tests catch drift.

// ---------------------------------------------------------------------------
// SqlField
// ---------------------------------------------------------------------------

// fieldKind names the semantic constructor that produced a field.
//
//dashicagen:enum
type fieldKind struct{ v string }

var (
	kindExpr       = fieldKind{"expr"}
	kindCount      = fieldKind{"count"}
	kindEnum       = fieldKind{"enum"}
	kindAutoBucket = fieldKind{"autoBucket"}
)

// sqlFieldDTO is the wire form of every SqlField. Not all keys apply to every
// kind: "expr"/"count"/"enum" carry definition+alias (+xBucketSizeMs for
// timestamped fields); "autoBucket" carries column+alias+xBucketSizeMs (its size
// until the server picks one for the time range).
type sqlFieldDTO struct {
	Kind          fieldKind `json:"kind"`
	Definition    string    `json:"definition,omitempty"`
	Alias         string    `json:"alias"`
	Column        string    `json:"column,omitempty"`
	XBucketSizeMs int64     `json:"xBucketSizeMs,omitempty"`
}

func (f *fieldImpl) MarshalJSON() ([]byte, error) {
	kind := f.kind
	if kind == (fieldKind{}) {
		kind = kindExpr
	}
	return json.Marshal(sqlFieldDTO{
		Kind:          kind,
		Definition:    f.definition,
		Alias:         f.alias,
		XBucketSizeMs: f.timestamp_xBucketSizeMs,
	})
}

func (f *autoBucketFieldImpl) MarshalJSON() ([]byte, error) {
	return json.Marshal(sqlFieldDTO{
		Kind:          kindAutoBucket,
		Column:        f.column_,
		Alias:         f.alias_,
		XBucketSizeMs: f.sizeMs,
	})
}

// MarshalField serializes any SqlField to its tagged envelope. Generated widget
// serializers call this for their interface-typed field members.
func MarshalField(f SqlField) ([]byte, error) {
	if f == nil {
		return []byte("null"), nil
	}
	return json.Marshal(f)
}

// sqlFieldPropsDTO is a SqlField in a widget's props in page.json: what the client draws and selects by.
type sqlFieldPropsDTO struct {
	// Kind tells a category, which a click selects, from a count (a measure).
	Kind fieldKind `json:"kind"`
	// Alias is the field's column in the query result.
	Alias string `json:"alias"`
	// XBucketSizeMs is a time axis' bucket size; an AutoBucket's until the server picks one for the time range.
	XBucketSizeMs int64 `json:"xBucketSizeMs,omitempty"`
}

// MarshalFieldProps serializes `f` for a widget's props in page.json: its kind, alias and bucket size, what the
// client draws and selects by. Generated marshalProps call this for their field members.
func MarshalFieldProps(f SqlField) ([]byte, error) {
	switch f := f.(type) {
	case nil:
		return []byte("null"), nil
	case *autoBucketFieldImpl:
		return json.Marshal(sqlFieldPropsDTO{Kind: kindAutoBucket, Alias: f.alias_, XBucketSizeMs: f.sizeMs})
	case *fieldImpl:
		kind := f.kind
		if kind == (fieldKind{}) {
			kind = kindExpr
		}
		return json.Marshal(sqlFieldPropsDTO{Kind: kind, Alias: f.alias, XBucketSizeMs: f.timestamp_xBucketSizeMs})
	}
	return nil, fmt.Errorf("MarshalFieldProps: unknown field type %T", f)
}

// UnmarshalField reconstructs the concrete SqlField named by the "kind"
// discriminator. Returns nil for a JSON null (optional fields).
func UnmarshalField(b []byte) (SqlField, error) {
	if isJSONNull(b) {
		return nil, nil
	}
	var dto sqlFieldDTO
	if err := json.Unmarshal(b, &dto); err != nil {
		return nil, err
	}
	// an unknown kind is refused by fieldKind's UnmarshalJSON
	if dto.Kind == kindAutoBucket {
		return AutoBucketAs(dto.Column, dto.Alias), nil
	}
	// Reconstruct the fieldImpl directly (not via the semantic constructor)
	// so Build() output is byte-identical to the original regardless of
	// kind; kind is metadata for codegen/editor only.
	return &fieldImpl{
		kind:                    dto.Kind,
		definition:              dto.Definition,
		alias:                   dto.Alias,
		timestamp_xBucketSizeMs: dto.XBucketSizeMs,
	}, nil
}

// marshalFields serializes a slice of SqlField to a slice of raw JSON envelopes.
func marshalFields(fields []SqlField) ([]json.RawMessage, error) {
	if len(fields) == 0 {
		return nil, nil
	}
	out := make([]json.RawMessage, len(fields))
	for i, f := range fields {
		b, err := MarshalField(f)
		if err != nil {
			return nil, fmt.Errorf("field %d: %w", i, err)
		}
		out[i] = b
	}
	return out, nil
}

// unmarshalFields is the inverse of marshalFields.
func unmarshalFields(raw []json.RawMessage) ([]SqlField, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	out := make([]SqlField, len(raw))
	for i, b := range raw {
		f, err := UnmarshalField(b)
		if err != nil {
			return nil, fmt.Errorf("field %d: %w", i, err)
		}
		out[i] = f
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// SqlQueryable
// ---------------------------------------------------------------------------

// queryKind names which SqlQueryable a queryDTO is.
//
//dashicagen:enum
type queryKind struct{ v string }

var (
	queryTable = queryKind{"table"}
	queryFile  = queryKind{"file"}
	queryRaw   = queryKind{"raw"}
)

// queryDTO is the wire form of every SqlQueryable. The "kind" discriminator
// selects which subset of keys is meaningful:
//   - "table": table, select, where, groupBy, orderBy, limit, fillStep, ...
//   - "file":  path, table (its Table), where, database, skipFilters, autoBucket
//   - "raw":   sql, table (its Table), where, database, skipFilters, autoBucket
type queryDTO struct {
	Kind queryKind `json:"kind"`

	// table (SqlQuery: its From; SqlFile, SqlString: its Table)
	Table                 string            `json:"table,omitempty"`
	Select                []json.RawMessage `json:"select,omitempty"`
	GroupBy               []json.RawMessage `json:"groupBy,omitempty"`
	OrderBy               []json.RawMessage `json:"orderBy,omitempty"`
	Limit                 int               `json:"limit,omitempty"`
	FillStep              string            `json:"fillStep,omitempty"`
	AutoBucketPlaceholder bool              `json:"autoBucketPlaceholder,omitempty"`

	// file (SqlFile)
	Path string `json:"path,omitempty"`

	// raw (SqlString)
	Sql string `json:"sql,omitempty"`

	// shared
	Where       []string `json:"where,omitempty"`
	Database    string   `json:"database,omitempty"`
	SkipFilters bool     `json:"skipFilters,omitempty"`
	AutoBucket  bool     `json:"autoBucket,omitempty"` // file/raw placeholder opt-in
}

func (q *SqlQuery) MarshalJSON() ([]byte, error) {
	sel, err := marshalFields(q.selectF)
	if err != nil {
		return nil, fmt.Errorf("select: %w", err)
	}
	grp, err := marshalFields(q.groupBy)
	if err != nil {
		return nil, fmt.Errorf("groupBy: %w", err)
	}
	ord, err := marshalFields(q.orderBy)
	if err != nil {
		return nil, fmt.Errorf("orderBy: %w", err)
	}
	return json.Marshal(queryDTO{
		Kind:                  queryTable,
		Table:                 q.from,
		Select:                sel,
		GroupBy:               grp,
		OrderBy:               ord,
		Limit:                 q.limit,
		FillStep:              q.fillStep,
		AutoBucketPlaceholder: q.autoBucketPlaceholder,
		Where:                 q.where,
		Database:              q.database,
		SkipFilters:           q.shouldSkipFilters,
	})
}

func (q *SqlQuery) UnmarshalJSON(b []byte) error {
	var dto queryDTO
	if err := json.Unmarshal(b, &dto); err != nil {
		return err
	}
	sel, err := unmarshalFields(dto.Select)
	if err != nil {
		return fmt.Errorf("select: %w", err)
	}
	grp, err := unmarshalFields(dto.GroupBy)
	if err != nil {
		return fmt.Errorf("groupBy: %w", err)
	}
	ord, err := unmarshalFields(dto.OrderBy)
	if err != nil {
		return fmt.Errorf("orderBy: %w", err)
	}
	*q = SqlQuery{
		selectF:               sel,
		from:                  dto.Table,
		where:                 dto.Where,
		groupBy:               grp,
		orderBy:               ord,
		limit:                 dto.Limit,
		fillStep:              dto.FillStep,
		shouldSkipFilters:     dto.SkipFilters,
		database:              dto.Database,
		autoBucketPlaceholder: dto.AutoBucketPlaceholder,
	}
	return nil
}

func (f *SqlFile) MarshalJSON() ([]byte, error) {
	return json.Marshal(queryDTO{
		Kind:        queryFile,
		Path:        f.path,
		Table:       f.table,
		Where:       f.where,
		Database:    f.database,
		SkipFilters: f.shouldSkipFilters,
		AutoBucket:  f.autoBucket,
	})
}

func (f *SqlFile) UnmarshalJSON(b []byte) error {
	var dto queryDTO
	if err := json.Unmarshal(b, &dto); err != nil {
		return err
	}
	*f = SqlFile{
		path:              dto.Path,
		table:             dto.Table,
		shouldSkipFilters: dto.SkipFilters,
		where:             dto.Where,
		database:          dto.Database,
		autoBucket:        dto.AutoBucket,
	}
	return nil
}

func (s *SqlString) MarshalJSON() ([]byte, error) {
	return json.Marshal(queryDTO{
		Kind:        queryRaw,
		Sql:         s.content,
		Table:       s.table,
		Where:       s.where,
		Database:    s.database,
		SkipFilters: s.shouldSkipFilters,
		AutoBucket:  s.autoBucket,
	})
}

func (s *SqlString) UnmarshalJSON(b []byte) error {
	var dto queryDTO
	if err := json.Unmarshal(b, &dto); err != nil {
		return err
	}
	*s = SqlString{
		content:           dto.Sql,
		table:             dto.Table,
		shouldSkipFilters: dto.SkipFilters,
		where:             dto.Where,
		database:          dto.Database,
		autoBucket:        dto.AutoBucket,
	}
	return nil
}

// MarshalQueryable serializes any SqlQueryable to its tagged envelope.
func MarshalQueryable(q SqlQueryable) ([]byte, error) {
	if q == nil {
		return []byte("null"), nil
	}
	return json.Marshal(q)
}

// UnmarshalQueryable reconstructs the concrete SqlQueryable named by "kind".
func UnmarshalQueryable(b []byte) (SqlQueryable, error) {
	if isJSONNull(b) {
		return nil, nil
	}
	// an unknown kind is refused by queryKind's UnmarshalJSON
	var probe struct {
		Kind queryKind `json:"kind"`
	}
	if err := json.Unmarshal(b, &probe); err != nil {
		return nil, err
	}
	switch probe.Kind {
	case queryTable:
		var q SqlQuery
		if err := json.Unmarshal(b, &q); err != nil {
			return nil, err
		}
		return &q, nil
	case queryFile:
		var f SqlFile
		if err := json.Unmarshal(b, &f); err != nil {
			return nil, err
		}
		return &f, nil
	case queryRaw:
		var s SqlString
		if err := json.Unmarshal(b, &s); err != nil {
			return nil, err
		}
		return &s, nil
	default:
		return nil, fmt.Errorf("sql: a queryable needs its kind: table, file or raw")
	}
}

func isJSONNull(b []byte) bool {
	return bytes.Equal(bytes.TrimSpace(b), []byte("null"))
}
