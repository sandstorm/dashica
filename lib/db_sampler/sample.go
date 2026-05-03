package db_sampler

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/sandstorm/dashica/lib/clickhouse"
)

// SampleConfig tunes how a single table is profiled.
type SampleConfig struct {
	// Database name; if empty, uses the client's configured database.
	Database string

	// WhereClause is a SQL fragment (without the WHERE keyword) injected into
	// every data query. Use it to bound work — e.g.
	//   "timestamp > now() - INTERVAL 1 HOUR"
	// Empty = no filter, sample over the full table. Caller is responsible for
	// the SQL being valid for this table; columns referenced must exist.
	//
	// An LLM or operator can populate this per-table to focus sampling on
	// recent / interesting slices of data.
	WhereClause string

	// Recent, if non-empty, auto-builds a WHERE clause of the form
	//   <first DateTime sort-key column> > now() - INTERVAL <Recent>
	// E.g. "1 HOUR", "1 DAY". Requires the table to have a Date/DateTime/
	// DateTime64 column in its MergeTree ORDER BY. WhereClause takes priority
	// if both are set.
	//
	// Note: ClickHouse server-side max_execution_time is the only knob that
	// stops huge-table scans, and it is typically capped by server policy that
	// clients cannot raise. Use WhereClause / Recent to bound work — bumping
	// timeouts client-side won't help.
	Recent string

	// Columns whose contents are too large to enumerate (e.g. raw event blobs).
	SkipProfiling []string

	// Columns that are dashboard-wide partitioning dims rather than what-is-this-log
	// dims; excluded when falling back to listable columns for bucket selection.
	NonBucketDims []string

	// BucketDimsPref orders preferred bucket dims. Intersected with the table's
	// columns. Callers (or LLMs guiding the run) can prepend dims that existing
	// dashboard queries actually filter on, to make samples reflect real usage.
	BucketDimsPref []string

	MaxBucketDims    int // max bucket dims used per table (default 3)
	ListThreshold    int // list distinct values if approx cardinality < this (default 50)
	SamplesPerBucket int // sample rows per bucket (default 3)
	BucketLimit      int // max buckets per table (default 200)
}

func (c SampleConfig) withDefaults() SampleConfig {
	if len(c.SkipProfiling) == 0 {
		c.SkipProfiling = []string{"event_original"}
	}
	if len(c.NonBucketDims) == 0 {
		c.NonBucketDims = []string{"customer_tenant", "customer_project", "host_group", "host_name"}
	}
	if len(c.BucketDimsPref) == 0 {
		c.BucketDimsPref = []string{"event_dataset", "event_module", "level", "severity", "logfile", "operation"}
	}
	if c.MaxBucketDims == 0 {
		c.MaxBucketDims = 3
	}
	if c.ListThreshold == 0 {
		c.ListThreshold = 50
	}
	if c.SamplesPerBucket == 0 {
		c.SamplesPerBucket = 3
	}
	if c.BucketLimit == 0 {
		c.BucketLimit = 200
	}
	return c
}

// TableProfile is the JSON shape written per table.
type TableProfile struct {
	Metadata    ProfileMetadata       `json:"metadata"`
	ColumnStats map[string]ColumnStat `json:"column_stats"`
	Buckets     []Bucket              `json:"buckets"`
}

type ProfileMetadata struct {
	SampledAt        string   `json:"sampled_at"`
	Table            string   `json:"table"`
	Database         string   `json:"database"`
	TotalRowsApprox  int64    `json:"total_rows_approx"`
	BucketDimensions []string `json:"bucket_dimensions"`
	ListThreshold    int      `json:"list_threshold"`
	SamplesPerBucket int      `json:"samples_per_bucket"`
	// SortingKey is the table's MergeTree ORDER BY columns. Operators (and LLMs)
	// can use the first column to construct a fast WHERE clause — ClickHouse
	// only scans relevant granules when filtering on a leading sort-key column.
	SortingKey []string `json:"sorting_key,omitempty"`
	// AppliedWhere is the WHERE fragment that was used during this sample run
	// (either explicit SampleConfig.WhereClause, or auto-derived from Recent).
	AppliedWhere string `json:"applied_where,omitempty"`
}

// ColumnStat holds either an enumerated value list (for low-cardinality cols)
// or just an approximate cardinality.
type ColumnStat struct {
	Type              string        `json:"type"`
	Cardinality       *int          `json:"cardinality,omitempty"`
	CardinalityApprox *int          `json:"cardinality_approx,omitempty"`
	Values            []ColumnValue `json:"values,omitempty"`
}

type ColumnValue struct {
	Value any   `json:"value"`
	Count int64 `json:"count"`
}

type Bucket struct {
	Dims    map[string]any   `json:"dims"`
	Count   int64            `json:"count"`
	Samples []map[string]any `json:"samples"`
}

// ListSampleableTables lists tables (engine NOT IN View/MaterializedView, name
// not starting with '.') in the given database.
func ListSampleableTables(ctx context.Context, c *clickhouse.Client, database string) ([]string, error) {
	type row struct {
		Name string `json:"name"`
	}
	opts := clickhouse.DefaultQueryOptions()
	opts.Format = "JSON"
	if database != "" {
		opts.Parameters["db"] = database
	}
	dbExpr := "currentDatabase()"
	if database != "" {
		dbExpr = "{db:String}"
	}
	q := fmt.Sprintf(
		`SELECT name FROM system.tables WHERE database = %s AND engine NOT IN ('View','MaterializedView') AND NOT startsWith(name, '.') ORDER BY name`,
		dbExpr,
	)
	res, err := clickhouse.QueryJSON[row](ctx, c, q, opts)
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(res.Data))
	for _, r := range res.Data {
		out = append(out, r.Name)
	}
	return out, nil
}

// SampleTable profiles a single table. Output is RAW (no anonymization);
// pipe through AnonymizeProfile before writing to a shared location.
func SampleTable(ctx context.Context, c *clickhouse.Client, table string, cfg SampleConfig) (TableProfile, error) {
	cfg = cfg.withDefaults()
	if !validIdent(table) {
		return TableProfile{}, fmt.Errorf("invalid table identifier: %s", table)
	}

	cols, err := fetchColumns(ctx, c, cfg.Database, table)
	if err != nil {
		return TableProfile{}, fmt.Errorf("columns: %w", err)
	}

	totalRows, err := fetchTotalRows(ctx, c, cfg.Database, table)
	if err != nil {
		return TableProfile{}, fmt.Errorf("total rows: %w", err)
	}

	sortingKey, err := fetchSortingKey(ctx, c, cfg.Database, table)
	if err != nil {
		return TableProfile{}, fmt.Errorf("sorting key: %w", err)
	}

	// Resolve Recent → WhereClause if WhereClause not already set. If the table
	// has no Date/DateTime column in its sort key, Recent is a no-op (bounding
	// is not applicable for that table — lookup tables, etc.).
	if cfg.WhereClause == "" && cfg.Recent != "" {
		colByNameTmp := make(map[string]string, len(cols))
		for _, c := range cols {
			colByNameTmp[c.Name] = c.Type
		}
		if col := firstDateTimeSortKey(sortingKey, colByNameTmp); col != "" {
			cfg.WhereClause = fmt.Sprintf("`%s` > now() - INTERVAL %s", col, cfg.Recent)
		}
	}

	// Partition columns into listable (enumerate exhaustively) vs probe (uniq first).
	skip := toSet(cfg.SkipProfiling)
	var listable, probe []string
	colByName := make(map[string]string, len(cols))
	allColNames := make([]string, 0, len(cols))
	for _, col := range cols {
		colByName[col.Name] = col.Type
		allColNames = append(allColNames, col.Name)
		if _, sk := skip[col.Name]; sk {
			continue
		}
		if isListableType(col.Type) {
			listable = append(listable, col.Name)
		} else {
			probe = append(probe, col.Name)
		}
	}

	stats := make(map[string]ColumnStat, len(cols))

	for _, col := range listable {
		vs, err := enumerateValues(ctx, c, table, col, 500, cfg.WhereClause)
		if err != nil {
			return TableProfile{}, fmt.Errorf("enumerate %s: %w", col, err)
		}
		card := len(vs)
		stats[col] = ColumnStat{
			Type:        colByName[col],
			Cardinality: &card,
			Values:      vs,
		}
	}

	if len(probe) > 0 {
		approxByCol, err := batchUniq(ctx, c, table, probe, cfg.WhereClause)
		if err != nil {
			return TableProfile{}, fmt.Errorf("batch uniq: %w", err)
		}
		for _, col := range probe {
			approx := approxByCol[col]
			if approx > 0 && approx < cfg.ListThreshold && !isProbableNumeric(colByName[col]) {
				vs, err := enumerateValues(ctx, c, table, col, cfg.ListThreshold, cfg.WhereClause)
				if err != nil {
					return TableProfile{}, fmt.Errorf("enumerate probe %s: %w", col, err)
				}
				card := len(vs)
				stats[col] = ColumnStat{
					Type:        colByName[col],
					Cardinality: &card,
					Values:      vs,
				}
			} else {
				ap := approx
				stats[col] = ColumnStat{
					Type:              colByName[col],
					CardinalityApprox: &ap,
				}
			}
		}
	}

	bucketDims := selectBucketDims(allColNames, listable, cfg.BucketDimsPref, cfg.NonBucketDims, cfg.MaxBucketDims)

	var buckets []Bucket
	if len(bucketDims) > 0 {
		bucketRows, err := groupByBuckets(ctx, c, table, bucketDims, cfg.BucketLimit, cfg.WhereClause)
		if err != nil {
			return TableProfile{}, fmt.Errorf("group by buckets: %w", err)
		}
		// Pick an ORDER BY column for the bucket sample query: prefer "timestamp"
		// if it exists, else the first bare sort-key column, else nothing.
		orderCol := ""
		colSet := make(map[string]struct{}, len(cols))
		for _, c := range cols {
			colSet[c.Name] = struct{}{}
		}
		if _, ok := colSet["timestamp"]; ok {
			orderCol = "timestamp"
		} else {
			for _, k := range sortingKey {
				if _, ok := colSet[k]; ok && validIdent(k) {
					orderCol = k
					break
				}
			}
		}
		for _, br := range bucketRows {
			samples, err := sampleBucket(ctx, c, table, bucketDims, br.dims, cfg.SamplesPerBucket, cfg.WhereClause, orderCol, cfg.SkipProfiling)
			if err != nil {
				return TableProfile{}, fmt.Errorf("sample bucket: %w", err)
			}
			buckets = append(buckets, Bucket{Dims: br.dims, Count: br.count, Samples: samples})
		}
	}

	dbName := cfg.Database
	if dbName == "" {
		dbName = "(default)"
	}

	return TableProfile{
		Metadata: ProfileMetadata{
			SampledAt:        time.Now().UTC().Format("2006-01-02T15:04:05Z"),
			Table:            table,
			Database:         dbName,
			TotalRowsApprox:  totalRows,
			BucketDimensions: bucketDims,
			ListThreshold:    cfg.ListThreshold,
			SamplesPerBucket: cfg.SamplesPerBucket,
			SortingKey:       sortingKey,
			AppliedWhere:     cfg.WhereClause,
		},
		ColumnStats: stats,
		Buckets:     buckets,
	}, nil
}

// fetchSortingKey returns the table's MergeTree ORDER BY columns (in order),
// or nil if the table has no sorting_key recorded.
func fetchSortingKey(ctx context.Context, c *clickhouse.Client, database, table string) ([]string, error) {
	type row struct {
		SortingKey string `json:"sorting_key"`
	}
	opts := clickhouse.DefaultQueryOptions()
	opts.Format = "JSON"
	opts.Parameters["table"] = table
	dbExpr := "currentDatabase()"
	if database != "" {
		opts.Parameters["db"] = database
		dbExpr = "{db:String}"
	}
	q := fmt.Sprintf(
		`SELECT sorting_key FROM system.tables WHERE database = %s AND name = {table:String}`,
		dbExpr,
	)
	res, err := clickhouse.QueryJSON[row](ctx, c, q, opts)
	if err != nil {
		return nil, err
	}
	if len(res.Data) == 0 || strings.TrimSpace(res.Data[0].SortingKey) == "" {
		return nil, nil
	}
	parts := strings.Split(res.Data[0].SortingKey, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		// Sort key entries can be expressions, e.g. "toStartOfHour(timestamp)";
		// take simple bare identifiers, drop wrappers.
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		out = append(out, p)
	}
	return out, nil
}

// firstDateTimeSortKey returns the first sort-key entry that is a bare
// identifier of a Date/DateTime/DateTime64 column. Returns "" if none.
func firstDateTimeSortKey(sortKey []string, colTypes map[string]string) string {
	for _, entry := range sortKey {
		// only handle bare identifiers, not expressions
		if !validIdent(entry) {
			continue
		}
		t, ok := colTypes[entry]
		if !ok {
			continue
		}
		base := leadingWrapperRe.ReplaceAllString(t, "")
		if strings.HasPrefix(base, "Date") {
			return entry
		}
	}
	return ""
}

// AnonymizeProfile returns a copy of profile with all sample-row values and
// column-stat values run through p. Metadata is preserved as-is.
func AnonymizeProfile(profile TableProfile, p Processor) TableProfile {
	out := TableProfile{
		Metadata:    profile.Metadata,
		ColumnStats: make(map[string]ColumnStat, len(profile.ColumnStats)),
		Buckets:     make([]Bucket, 0, len(profile.Buckets)),
	}
	for col, stat := range profile.ColumnStats {
		copyStat := stat
		if len(stat.Values) > 0 {
			copyStat.Values = make([]ColumnValue, len(stat.Values))
			for i, v := range stat.Values {
				nv, skip := p(col, v.Value)
				if skip {
					copyStat.Values[i] = ColumnValue{Value: nil, Count: v.Count}
					continue
				}
				copyStat.Values[i] = ColumnValue{Value: nv, Count: v.Count}
			}
		}
		out.ColumnStats[col] = copyStat
	}
	for _, b := range profile.Buckets {
		// Dims must go through the Processor too — otherwise raw values like
		// public IPs leak into both the JSON and (via WriteSplit) the bucket
		// filename. AnonymizeRow handles map[string]any correctly.
		nb := Bucket{Dims: AnonymizeRow(b.Dims, p), Count: b.Count}
		nb.Samples = make([]map[string]any, 0, len(b.Samples))
		for _, s := range b.Samples {
			nb.Samples = append(nb.Samples, AnonymizeRow(s, p))
		}
		out.Buckets = append(out.Buckets, nb)
	}
	return out
}

// Overview is the per-table summary written by WriteSplit (without sample
// rows). Each BucketRef points at a separate bucket file in the same dir.
type Overview struct {
	Metadata    ProfileMetadata       `json:"metadata"`
	ColumnStats map[string]ColumnStat `json:"column_stats"`
	Buckets     []BucketRef           `json:"buckets"`
}

type BucketRef struct {
	File  string         `json:"file"`
	Dims  map[string]any `json:"dims"`
	Count int64          `json:"count"`
}

// WriteSplit writes the profile as one overview.json + one bucket_NNN file per
// bucket under dir. Reduces noise vs. a single 600KB JSON for tables with many
// buckets and lets readers skim bucket dims/counts before drilling in.
func (p TableProfile) WriteSplit(dir string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	// Clean stale bucket files from a previous run so dim changes don't leave
	// orphans. Everything under dir is a bucket file except overview.json.
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if e.IsDir() || e.Name() == "overview.json" || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		_ = os.Remove(filepath.Join(dir, e.Name()))
	}

	overview := Overview{
		Metadata:    p.Metadata,
		ColumnStats: p.ColumnStats,
		Buckets:     make([]BucketRef, 0, len(p.Buckets)),
	}
	used := make(map[string]int, len(p.Buckets))
	for _, b := range p.Buckets {
		fname := bucketFilename(b.Dims)
		// Disambiguate the rare case where two buckets sanitize to the same name.
		if n := used[fname]; n > 0 {
			base := strings.TrimSuffix(fname, ".json")
			fname = fmt.Sprintf("%s__%d.json", base, n+1)
		}
		used[bucketFilename(b.Dims)]++
		if err := writeJSONPretty(filepath.Join(dir, fname), b); err != nil {
			return fmt.Errorf("write bucket %s: %w", fname, err)
		}
		overview.Buckets = append(overview.Buckets, BucketRef{File: fname, Dims: b.Dims, Count: b.Count})
	}
	if err := writeJSONPretty(filepath.Join(dir, "overview.json"), overview); err != nil {
		return fmt.Errorf("write overview: %w", err)
	}
	return nil
}

// ReadSplit reads back what WriteSplit wrote and reconstitutes a TableProfile.
func ReadSplit(dir string) (TableProfile, error) {
	var overview Overview
	if err := readJSON(filepath.Join(dir, "overview.json"), &overview); err != nil {
		return TableProfile{}, fmt.Errorf("read overview: %w", err)
	}
	out := TableProfile{
		Metadata:    overview.Metadata,
		ColumnStats: overview.ColumnStats,
		Buckets:     make([]Bucket, 0, len(overview.Buckets)),
	}
	for _, ref := range overview.Buckets {
		var b Bucket
		if err := readJSON(filepath.Join(dir, ref.File), &b); err != nil {
			return TableProfile{}, fmt.Errorf("read %s: %w", ref.File, err)
		}
		out.Buckets = append(out.Buckets, b)
	}
	return out, nil
}

func writeJSONPretty(path string, v any) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	enc := json.NewEncoder(f)
	enc.SetIndent("", "  ")
	enc.SetEscapeHTML(false)
	return enc.Encode(v)
}

func readJSON(path string, dst any) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	body, err := io.ReadAll(f)
	if err != nil {
		return err
	}
	return json.Unmarshal(body, dst)
}

var bucketSafeRe = regexp.MustCompile(`[^A-Za-z0-9._-]+`)

// bucketFilename produces a descriptive name from the bucket's dim values, e.g.
//
//	"event_dataset=oekokiste_shop_log__level=error.json"
//
// Falls back to "bucket.json" if dims produce nothing useful.
func bucketFilename(dims map[string]any) string {
	parts := make([]string, 0, len(dims))
	keys := make([]string, 0, len(dims))
	for k := range dims {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	for _, k := range keys {
		v := fmt.Sprintf("%v", dims[k])
		v = bucketSafeRe.ReplaceAllString(v, "_")
		v = strings.Trim(v, "_")
		if v == "" {
			v = "empty"
		}
		if len(v) > 25 {
			v = v[:25]
		}
		parts = append(parts, fmt.Sprintf("%s=%s", k, v))
	}
	name := strings.Join(parts, "__")
	if name == "" {
		name = "bucket"
	}
	if len(name) > 150 {
		name = name[:150]
	}
	return name + ".json"
}

// ─── ClickHouse helpers ──────────────────────────────────────────────────────

type columnRow struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

func fetchColumns(ctx context.Context, c *clickhouse.Client, database, table string) ([]columnRow, error) {
	opts := clickhouse.DefaultQueryOptions()
	opts.Format = "JSON"
	opts.Parameters["table"] = table
	dbExpr := "currentDatabase()"
	if database != "" {
		opts.Parameters["db"] = database
		dbExpr = "{db:String}"
	}
	q := fmt.Sprintf(
		`SELECT name, type FROM system.columns WHERE database = %s AND table = {table:String} ORDER BY position`,
		dbExpr,
	)
	res, err := clickhouse.QueryJSON[columnRow](ctx, c, q, opts)
	if err != nil {
		return nil, err
	}
	return res.Data, nil
}

func fetchTotalRows(ctx context.Context, c *clickhouse.Client, database, table string) (int64, error) {
	type row struct {
		Total json.Number `json:"total"`
	}
	opts := clickhouse.DefaultQueryOptions()
	opts.Format = "JSON"
	opts.Parameters["table"] = table
	dbExpr := "currentDatabase()"
	if database != "" {
		opts.Parameters["db"] = database
		dbExpr = "{db:String}"
	}
	q := fmt.Sprintf(
		`SELECT SUM(rows) AS total FROM system.parts WHERE active AND database = %s AND table = {table:String}`,
		dbExpr,
	)
	res, err := clickhouse.QueryJSON[row](ctx, c, q, opts)
	if err != nil {
		return 0, err
	}
	if len(res.Data) == 0 {
		return 0, nil
	}
	if res.Data[0].Total == "" {
		return 0, nil
	}
	n, _ := res.Data[0].Total.Int64()
	return n, nil
}

func enumerateValues(ctx context.Context, c *clickhouse.Client, table, col string, limit int, where string) ([]ColumnValue, error) {
	if !validIdent(table) || !validIdent(col) {
		return nil, fmt.Errorf("invalid identifier")
	}
	type row struct {
		Value string      `json:"value"`
		Count json.Number `json:"count"`
	}
	opts := clickhouse.DefaultQueryOptions()
	opts.Format = "JSON"
	q := fmt.Sprintf(
		"SELECT toString(`%s`) AS value, count() AS count FROM `%s`%s GROUP BY value ORDER BY count DESC LIMIT %d",
		col, table, whereSuffix(where), limit,
	)
	res, err := clickhouse.QueryJSON[row](ctx, c, q, opts)
	if err != nil {
		return nil, err
	}
	out := make([]ColumnValue, 0, len(res.Data))
	for _, r := range res.Data {
		n, _ := r.Count.Int64()
		out = append(out, ColumnValue{Value: r.Value, Count: n})
	}
	return out, nil
}

func batchUniq(ctx context.Context, c *clickhouse.Client, table string, cols []string, where string) (map[string]int, error) {
	if !validIdent(table) {
		return nil, fmt.Errorf("invalid table")
	}
	// Alias as _uniq_<col> rather than <col> — otherwise the alias shadows the
	// real column and ClickHouse refuses any WHERE that references it
	// (Code 184 ILLEGAL_AGGREGATION).
	const aliasPrefix = "_uniq_"
	exprs := make([]string, 0, len(cols))
	for _, col := range cols {
		if !validIdent(col) {
			return nil, fmt.Errorf("invalid column: %s", col)
		}
		exprs = append(exprs, fmt.Sprintf("uniq(`%s`) AS `%s%s`", col, aliasPrefix, col))
	}
	opts := clickhouse.DefaultQueryOptions()
	opts.Format = "JSON"
	q := fmt.Sprintf("SELECT %s FROM `%s`%s", strings.Join(exprs, ", "), table, whereSuffix(where))
	res, err := clickhouse.QueryJSON[map[string]json.Number](ctx, c, q, opts)
	if err != nil {
		return nil, err
	}
	out := make(map[string]int, len(cols))
	if len(res.Data) == 0 {
		return out, nil
	}
	for alias, val := range res.Data[0] {
		col := strings.TrimPrefix(alias, aliasPrefix)
		n, _ := val.Int64()
		out[col] = int(n)
	}
	return out, nil
}

type bucketRow struct {
	dims  map[string]any
	count int64
}

func groupByBuckets(ctx context.Context, c *clickhouse.Client, table string, dims []string, limit int, where string) ([]bucketRow, error) {
	for _, d := range dims {
		if !validIdent(d) {
			return nil, fmt.Errorf("invalid dim: %s", d)
		}
	}
	dimList := make([]string, 0, len(dims))
	for _, d := range dims {
		dimList = append(dimList, "`"+d+"`")
	}
	opts := clickhouse.DefaultQueryOptions()
	opts.Format = "JSONEachRow"
	q := fmt.Sprintf(
		"SELECT %s, count() AS __cnt FROM `%s`%s GROUP BY %s ORDER BY __cnt DESC LIMIT %d",
		strings.Join(dimList, ", "), table, whereSuffix(where), strings.Join(dimList, ", "), limit,
	)
	resp, err := c.Query(ctx, q, opts)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	var out []bucketRow
	for _, line := range strings.Split(string(body), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var row map[string]any
		dec := json.NewDecoder(strings.NewReader(line))
		dec.UseNumber()
		if err := dec.Decode(&row); err != nil {
			continue
		}
		cnt, _ := toInt64(row["__cnt"])
		delete(row, "__cnt")
		out = append(out, bucketRow{dims: row, count: cnt})
	}
	return out, nil
}

func sampleBucket(ctx context.Context, c *clickhouse.Client, table string, dimNames []string, dimVals map[string]any, limit int, extraWhere string, orderCol string, skipCols []string) ([]map[string]any, error) {
	wheres := make([]string, 0, len(dimNames)+1)
	for _, d := range dimNames {
		wheres = append(wheres, fmt.Sprintf("`%s` = %s", d, sqlLiteral(dimVals[d])))
	}
	if strings.TrimSpace(extraWhere) != "" {
		wheres = append(wheres, "("+extraWhere+")")
	}
	opts := clickhouse.DefaultQueryOptions()
	opts.Format = "JSONEachRow"
	orderClause := ""
	if orderCol != "" && validIdent(orderCol) {
		orderClause = fmt.Sprintf(" ORDER BY `%s` DESC", orderCol)
	}
	// Drop skip-listed columns from sample rows. These are typically huge
	// blobs (e.g. event_original) that blow the server memory limit even at
	// LIMIT 3 — reading them off disk is the dominant cost.
	selectExpr := "*"
	if exceptList := validExceptList(skipCols); exceptList != "" {
		selectExpr = "* EXCEPT(" + exceptList + ")"
	}
	q := fmt.Sprintf("SELECT %s FROM `%s` WHERE %s%s LIMIT %d",
		selectExpr, table, strings.Join(wheres, " AND "), orderClause, limit)
	resp, err := c.Query(ctx, q, opts)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	var out []map[string]any
	for _, line := range strings.Split(string(body), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var row map[string]any
		dec := json.NewDecoder(strings.NewReader(line))
		dec.UseNumber()
		if err := dec.Decode(&row); err == nil {
			out = append(out, row)
		}
	}
	return out, nil
}

// ─── Type helpers ────────────────────────────────────────────────────────────

func isListableType(t string) bool {
	return strings.HasPrefix(t, "LowCardinality(") ||
		strings.HasPrefix(t, "Enum8(") ||
		strings.HasPrefix(t, "Enum16(") ||
		strings.HasPrefix(t, "Bool")
}

var leadingWrapperRe = regexp.MustCompile(`^(LowCardinality|Nullable)\(`)

func isProbableNumeric(t string) bool {
	base := leadingWrapperRe.ReplaceAllString(t, "")
	return strings.HasPrefix(base, "UInt") ||
		strings.HasPrefix(base, "Int") ||
		strings.HasPrefix(base, "Float") ||
		strings.HasPrefix(base, "Decimal") ||
		strings.HasPrefix(base, "Date") ||
		strings.HasPrefix(base, "DateTime") ||
		strings.HasPrefix(base, "IPv")
}

func selectBucketDims(allCols, listable, preferred, nonBucket []string, max int) []string {
	colSet := toSet(allCols)
	chosen := make([]string, 0, max)
	for _, p := range preferred {
		if _, ok := colSet[p]; ok {
			chosen = append(chosen, p)
		}
	}
	if len(chosen) == 0 {
		nb := toSet(nonBucket)
		for _, c := range listable {
			if _, ok := nb[c]; ok {
				continue
			}
			chosen = append(chosen, c)
		}
	}
	if len(chosen) > max {
		chosen = chosen[:max]
	}
	return slices.Clone(chosen)
}

// validExceptList returns a comma-separated, backtick-quoted list of valid
// identifiers, or "" if the input is empty / invalid. Defensive against
// SQL injection through SkipProfiling.
func validExceptList(cols []string) string {
	out := make([]string, 0, len(cols))
	for _, c := range cols {
		if validIdent(c) {
			out = append(out, "`"+c+"`")
		}
	}
	return strings.Join(out, ", ")
}

// whereSuffix returns " WHERE <clause>" if clause is non-empty, else "".
func whereSuffix(clause string) string {
	if strings.TrimSpace(clause) == "" {
		return ""
	}
	return " WHERE (" + clause + ")"
}

func toSet(ss []string) map[string]struct{} {
	out := make(map[string]struct{}, len(ss))
	for _, s := range ss {
		out[s] = struct{}{}
	}
	return out
}

func toInt64(v any) (int64, bool) {
	switch x := v.(type) {
	case json.Number:
		n, err := x.Int64()
		return n, err == nil
	case float64:
		return int64(x), true
	case int64:
		return x, true
	}
	return 0, false
}

// sqlLiteral renders a value as a ClickHouse SQL literal for WHERE clauses.
// Strings are single-quoted with backslash and apostrophe escaped; numbers
// pass through; nil → NULL.
func sqlLiteral(v any) string {
	switch x := v.(type) {
	case nil:
		return "NULL"
	case string:
		return "'" + strings.NewReplacer(`\`, `\\`, `'`, `\'`).Replace(x) + "'"
	case json.Number:
		return x.String()
	case bool:
		if x {
			return "1"
		}
		return "0"
	default:
		return "'" + strings.NewReplacer(`\`, `\\`, `'`, `\'`).Replace(fmt.Sprintf("%v", x)) + "'"
	}
}
