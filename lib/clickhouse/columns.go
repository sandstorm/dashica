package clickhouse

import (
	"context"
	"fmt"
	"sync"

	"golang.org/x/sync/singleflight"
)

// Columns are the names of the columns of `table` (a mounted chart's From: `http_logs`, `monitoring.full_logs`) that
// a filter value compares with, as DESCRIBE TABLE gives them: those of a type ClassifyColumnType knows (numbers,
// strings, enums, dates, UUID, IP, Bool). A Map, Array, Tuple or JSON column compares only with its value written as
// ClickHouse SQL, which a click never gives.
func (c *Client) Columns(ctx context.Context, table string) ([]string, error) {
	return c.columns.get(table, func() ([]string, error) {
		// `table` is the From of a chart a dashboard mounts, written in Go: Explore's preview, whose widget comes
		// from the request, sends no filters, so it asks none
		result, err := QueryJSON[struct {
			Name string `json:"name"`
			Type string `json:"type"`
		}](ctx, c, "DESCRIBE TABLE "+table, DefaultQueryOptions())
		if err != nil {
			return nil, fmt.Errorf("DESCRIBE TABLE %s: %w", table, err)
		}
		columns := make([]string, 0, len(result.Data))
		for _, row := range result.Data {
			if ClassifyColumnType(row.Type) != "" {
				columns = append(columns, row.Name)
			}
		}
		return columns, nil
	})
}

// tableColumns are the columns of each table, as `describe` gave them, kept until restart. The first requests for a
// table share one `describe`; a failed one is asked again by the next request.
type tableColumns struct {
	mutex  sync.Mutex
	known  map[string][]string
	flight singleflight.Group
}

// get are the columns of `table`: kept ones, else those `describe` gives.
func (t *tableColumns) get(table string, describe func() ([]string, error)) ([]string, error) {
	t.mutex.Lock()
	known, ok := t.known[table]
	t.mutex.Unlock()
	if ok {
		return known, nil
	}
	columns, err, _ := t.flight.Do(table, func() (any, error) {
		columns, err := describe()
		if err != nil {
			return nil, err
		}
		t.mutex.Lock()
		if t.known == nil {
			t.known = map[string][]string{}
		}
		t.known[table] = columns
		t.mutex.Unlock()
		return columns, nil
	})
	if err != nil {
		return nil, err
	}
	return columns.([]string), nil
}

// Columns are the column names of `table` on the server `server` ("" for "default"), as Client.Columns gives them;
// a filter.Columns.
func (cm *Manager) Columns(ctx context.Context, server, table string) ([]string, error) {
	if server == "" {
		server = "default"
	}
	client, err := cm.GetClient(server)
	if err != nil {
		return nil, err
	}
	return client.Columns(ctx, table)
}
