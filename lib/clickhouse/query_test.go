package clickhouse

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/rs/zerolog"
	"github.com/sandstorm/dashica/lib/config"
)

// Tests for Client.Query: the settings it sends to ClickHouse.

func TestQuerySendsCancelOnClientClose(t *testing.T) {
	cases := []struct {
		name     string
		settings map[string]string
		want     string
	}{
		{"default", nil, "1"},
		{"caller's value wins", map[string]string{"cancel_http_readonly_queries_on_client_close": "0"}, "0"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var got url.Values
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				got = r.URL.Query()
			}))
			defer server.Close()

			client := NewClient(&config.ClickHouseConfig{URL: server.URL}, "test", zerolog.Nop())
			resp, err := client.Query(context.Background(), "SELECT 1", QueryOptions{Settings: tc.settings})
			if err != nil {
				t.Fatal(err)
			}
			resp.Body.Close()

			if values := got["cancel_http_readonly_queries_on_client_close"]; len(values) != 1 || values[0] != tc.want {
				t.Errorf("cancel_http_readonly_queries_on_client_close = %v, want [%s]", values, tc.want)
			}
		})
	}
}
