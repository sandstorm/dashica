package db_sampler

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/sandstorm/dashica/lib/clickhouse"
)

// Schema is the result of DumpSchema: DDL strings for tables and views.
type Schema struct {
	Tables map[string]string // name → SHOW CREATE TABLE output
	Views  map[string]string // name → SHOW CREATE TABLE output
}

// SchemaOptions tunes which tables/views are pulled.
type SchemaOptions struct {
	// Database name to pull from. If empty, the client's configured database is used.
	Database string
	// ViewNamePatterns: any table whose name contains one of these substrings is
	// classified as a view. Defaults to ["_mv", "_view", "materialized"].
	ViewNamePatterns []string
}

func (o SchemaOptions) viewPatterns() []string {
	if len(o.ViewNamePatterns) == 0 {
		return []string{"_mv", "_view", "materialized"}
	}
	return o.ViewNamePatterns
}

// DumpSchema pulls SHOW CREATE TABLE for every table in the database.
func DumpSchema(ctx context.Context, c *clickhouse.Client, opts SchemaOptions) (Schema, error) {
	tables, err := listAllTables(ctx, c)
	if err != nil {
		return Schema{}, fmt.Errorf("list tables: %w", err)
	}

	out := Schema{
		Tables: map[string]string{},
		Views:  map[string]string{},
	}
	patterns := opts.viewPatterns()

	for _, t := range tables {
		ddl, err := showCreateTable(ctx, c, t)
		if err != nil {
			return Schema{}, fmt.Errorf("show create table %s: %w", t, err)
		}
		if matchesAny(t, patterns) {
			out.Views[t] = ddl
		} else {
			out.Tables[t] = ddl
		}
	}
	return out, nil
}

// WriteToDir writes <dir>/<table>.sql for tables and <dir>/views/<view>.sql for
// views. Creates directories as needed.
func (s Schema) WriteToDir(dir string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	for name, ddl := range s.Tables {
		if err := os.WriteFile(filepath.Join(dir, name+".sql"), []byte(ddl), 0o644); err != nil {
			return fmt.Errorf("write %s: %w", name, err)
		}
	}
	if len(s.Views) > 0 {
		viewDir := filepath.Join(dir, "views")
		if err := os.MkdirAll(viewDir, 0o755); err != nil {
			return err
		}
		for name, ddl := range s.Views {
			if err := os.WriteFile(filepath.Join(viewDir, name+".sql"), []byte(ddl), 0o644); err != nil {
				return fmt.Errorf("write view %s: %w", name, err)
			}
		}
	}
	return nil
}

func listAllTables(ctx context.Context, c *clickhouse.Client) ([]string, error) {
	type row struct {
		Name string `json:"name"`
	}
	opts := clickhouse.DefaultQueryOptions()
	opts.Format = "JSON"
	res, err := clickhouse.QueryJSON[row](ctx, c,
		`SELECT name FROM system.tables WHERE database = currentDatabase() AND NOT startsWith(name, '.') ORDER BY name`,
		opts)
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(res.Data))
	for _, r := range res.Data {
		out = append(out, r.Name)
	}
	return out, nil
}

func showCreateTable(ctx context.Context, c *clickhouse.Client, table string) (string, error) {
	if !validIdent(table) {
		return "", fmt.Errorf("invalid identifier: %s", table)
	}
	opts := clickhouse.DefaultQueryOptions()
	opts.Format = "TabSeparatedRaw"
	resp, err := c.Query(ctx, fmt.Sprintf("SHOW CREATE TABLE `%s`", table), opts)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	return strings.TrimRight(string(body), "\n"), nil
}

func matchesAny(s string, patterns []string) bool {
	low := strings.ToLower(s)
	for _, p := range patterns {
		if strings.Contains(low, strings.ToLower(p)) {
			return true
		}
	}
	return false
}

var identRe = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

func validIdent(s string) bool { return identRe.MatchString(s) }
