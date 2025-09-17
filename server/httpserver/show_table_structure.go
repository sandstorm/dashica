package httpserver

import (
	"fmt"
	"github.com/sandstorm/dashica/server/clickhouse"
	"net/http"
	"regexp"
)

type showTableStructureHandler struct {
	clickhouseClientManager *clickhouse.Manager
}

type showTableStructureResult struct {
	Statement string `json:"statement"`
}

func (sh showTableStructureHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) error {
	client, err := sh.clickhouseClientManager.GetClient("default")
	if err != nil {
		return fmt.Errorf("fetching client: %w", err)
	}

	table := r.URL.Query().Get("table")
	if table == "" {
		return fmt.Errorf("table must be given")
	}

	match, err := regexp.MatchString("^[a-z0-9_-]+$", table)
	if err != nil || !match {
		return fmt.Errorf("table does not conform to pattern")
	}
	fmt.Println(match)

	result, err := clickhouse.QueryJSONFirst[showTableStructureResult](r.Context(), client, fmt.Sprintf("SHOW CREATE TABLE %s", table), clickhouse.DefaultQueryOptions())
	if err != nil {
		return fmt.Errorf("executing query: %w", err)
	}
	_, _ = w.Write([]byte(result.Statement))

	return nil
}
