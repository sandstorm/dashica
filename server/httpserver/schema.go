package httpserver

import (
	"encoding/json"
	"fmt"
	"github.com/sandstorm/dashica/server/clickhouse"
	"net/http"
)

type schemaHandler struct {
	clickhouseClientManager *clickhouse.Manager
}

func (sh schemaHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) error {
	client, err := sh.clickhouseClientManager.GetClient("default")
	if err != nil {
		return fmt.Errorf("fetching client: %w", err)
	}

	schema, err := client.IntrospectSchema(r.Context())
	if err != nil {
		return fmt.Errorf("introspecting schema: %w", err)
	}

	bytes, err := json.Marshal(schema)
	if err != nil {
		return fmt.Errorf("marshalling JSON: %w", err)
	}
	w.Write(bytes)

	return nil
}
