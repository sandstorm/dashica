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

// fieldDTO is the wire form of every SqlField. Not all keys apply to every
// kind: "expr"/"count"/"enum" carry definition+alias (+xBucketSizeMs for
// timestamped fields); "autoBucket" carries column+alias.
type fieldDTO struct {
	Kind          string `json:"kind"`
	Definition    string `json:"definition,omitempty"`
	Alias         string `json:"alias,omitempty"`
	Column        string `json:"column,omitempty"`
	XBucketSizeMs int64  `json:"xBucketSizeMs,omitempty"`
}

func (f *fieldImpl) MarshalJSON() ([]byte, error) {
	kind := f.kind
	if kind == "" {
		kind = "expr"
	}
	return json.Marshal(fieldDTO{
		Kind:          kind,
		Definition:    f.definition,
		Alias:         f.alias,
		XBucketSizeMs: f.timestamp_xBucketSizeMs,
	})
}

func (f *autoBucketFieldImpl) MarshalJSON() ([]byte, error) {
	return json.Marshal(fieldDTO{
		Kind:   "autoBucket",
		Column: f.column_,
		Alias:  f.alias_,
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

// UnmarshalField reconstructs the concrete SqlField named by the "kind"
// discriminator. Returns nil for a JSON null (optional fields).
func UnmarshalField(b []byte) (SqlField, error) {
	if isJSONNull(b) {
		return nil, nil
	}
	var dto fieldDTO
	if err := json.Unmarshal(b, &dto); err != nil {
		return nil, err
	}
	switch dto.Kind {
	case "autoBucket":
		return AutoBucketAs(dto.Column, dto.Alias), nil
	case "", "expr", "count", "enum":
		// Reconstruct the fieldImpl directly (not via the semantic constructor)
		// so Build() output is byte-identical to the original regardless of
		// kind; kind is metadata for codegen/editor only.
		return &fieldImpl{
			kind:                    dto.Kind,
			definition:              dto.Definition,
			alias:                   dto.Alias,
			timestamp_xBucketSizeMs: dto.XBucketSizeMs,
		}, nil
	default:
		return nil, fmt.Errorf("sql: unknown field kind %q", dto.Kind)
	}
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

// queryDTO is the wire form of every SqlQueryable. The "kind" discriminator
// selects which subset of keys is meaningful:
//   - "table": table, select, where, groupBy, orderBy, limit, fillStep, ...
//   - "file":  path, where, database, skipFilters, autoBucket
//   - "raw":   sql, where, database, skipFilters, autoBucket
type queryDTO struct {
	Kind string `json:"kind"`

	// table (SqlQuery)
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
		Kind:                  "table",
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
		Kind:        "file",
		Path:        f.path,
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
		shouldSkipFilters: dto.SkipFilters,
		where:             dto.Where,
		database:          dto.Database,
		autoBucket:        dto.AutoBucket,
	}
	return nil
}

func (s *SqlString) MarshalJSON() ([]byte, error) {
	return json.Marshal(queryDTO{
		Kind:        "raw",
		Sql:         s.content,
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
	var probe struct {
		Kind string `json:"kind"`
	}
	if err := json.Unmarshal(b, &probe); err != nil {
		return nil, err
	}
	switch probe.Kind {
	case "table":
		var q SqlQuery
		if err := json.Unmarshal(b, &q); err != nil {
			return nil, err
		}
		return &q, nil
	case "file":
		var f SqlFile
		if err := json.Unmarshal(b, &f); err != nil {
			return nil, err
		}
		return &f, nil
	case "raw":
		var s SqlString
		if err := json.Unmarshal(b, &s); err != nil {
			return nil, err
		}
		return &s, nil
	default:
		return nil, fmt.Errorf("sql: unknown queryable kind %q", probe.Kind)
	}
}

func isJSONNull(b []byte) bool {
	return bytes.Equal(bytes.TrimSpace(b), []byte("null"))
}
