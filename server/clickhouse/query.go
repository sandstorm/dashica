package clickhouse

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/rs/zerolog"
	"github.com/sandstorm/dashica/server/core"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// Client represents a ClickHouse HTTP client for a specific server
type Client struct {
	Id           string
	serverConfig *core.ClickHouseConfig
	httpClient   *http.Client
	logger       zerolog.Logger

	introspectedSchemaMutex  sync.Mutex
	introspectedSchemaCached *IntrospectedSchema
}

// NewClient creates a new ClickHouse HTTP client for a specific server
func NewClient(serverConfig *core.ClickHouseConfig, id string, logger zerolog.Logger) *Client {
	return &Client{
		Id:           id,
		serverConfig: serverConfig,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
		logger: logger,
	}
}

// QueryOptions represents options that can be set when making a query
type QueryOptions struct {
	Format      string            // Output format (default: JSONEachRow)
	Settings    map[string]string // ClickHouse settings
	Parameters  map[string]string // Query parameters
	Compression bool              // Enable compression
}

// DefaultQueryOptions returns the default query options
func DefaultQueryOptions() QueryOptions {
	opts := QueryOptions{
		Format:      "Arrow",
		Settings:    make(map[string]string),
		Parameters:  make(map[string]string),
		Compression: false,
	}

	// relevant for alerting, where we use JSON output format.
	opts.Settings["output_format_json_quote_decimals"] = "0"
	opts.Settings["output_format_json_quote_64bit_integers"] = "0"
	opts.Settings["output_format_json_quote_64bit_floats"] = "0"

	return opts
}

// Query executes a READ ONLY SQL query and returns the response body
func (c *Client) Query(ctx context.Context, query string, options QueryOptions) (*http.Response, error) {
	return c.queryInternal(ctx, "GET", query, options)
}

// Execute a read/write SQL query and returns the response body
func (c *Client) Execute(ctx context.Context, query string, options QueryOptions) (*http.Response, error) {
	return c.queryInternal(ctx, "POST", query, options)
}

// Query executes a SQL query and returns the response body
func (c *Client) queryInternal(ctx context.Context, method string, query string, options QueryOptions) (*http.Response, error) {
	c.logger.Debug().
		Str("query", query).
		Str("clientId", c.Id).
		Dict("queryParams", zerolog.Dict().
			Fields(options.Parameters)).
		Msg("executing SQL query")

	// Build URL query parameters
	params := url.Values{}

	// Add database if specified
	if c.serverConfig.Database != "" {
		params.Add("database", c.serverConfig.Database)
	}

	// Add output format
	if options.Format == "" {
		options.Format = "JSONEachRow"
	}
	params.Add("default_format", options.Format)

	// Add settings
	for setting, value := range options.Settings {
		params.Add(setting, value)
	}

	// Add query parameters
	for param, value := range options.Parameters {
		params.Add(fmt.Sprintf("param_%s", param), value)
	}

	params.Add("query", query)
	// Build URL
	reqURL := fmt.Sprintf("%s?%s", c.serverConfig.URL, params.Encode())

	// Create request
	req, err := http.NewRequestWithContext(ctx, method, reqURL, nil)
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}

	// Set authentication
	if c.serverConfig.User != "" {
		req.SetBasicAuth(c.serverConfig.User, c.serverConfig.Password)
	}

	// Set headers
	req.Header.Set("Content-Type", "text/plain")

	// Enable compression if requested
	if options.Compression {
		req.Header.Set("Accept-Encoding", "gzip")
	}

	// Execute request
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("executing request: %w", err)
	}

	// Check for errors in response
	if resp.StatusCode != http.StatusOK {
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("unsuccessful clickhouse response (status %d): %s", resp.StatusCode, string(body))
	}

	return resp, nil
}

// QueryToHandler executes a SQL query and pipes the results directly to an HTTP response writer
func (c *Client) QueryToHandler(ctx context.Context, query string, options QueryOptions, w http.ResponseWriter) error {
	// Execute query
	resp, err := c.Query(ctx, query, options)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	// Copy headers from ClickHouse response to the output response
	for key, values := range resp.Header {
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}

	// Set content type based on format
	w.Header().Set("Content-Type", getContentType(options.Format))

	// Stream the response body to the output
	_, err = io.Copy(w, resp.Body)
	if err != nil {
		return fmt.Errorf("streaming response: %w", err)
	}

	return nil
}

type ClickhouseJsonResult[T any] struct {
	Meta []struct {
		Name string `json:"name"`
		Type string `json:"type"`
	} `json:"meta"`
	Data       []T `json:"data"`
	Rows       int `json:"rows"`
	Statistics struct {
		Elapsed   float64 `json:"elapsed"`
		RowsRead  int     `json:"rows_read"`
		BytesRead int     `json:"bytes_read"`
	} `json:"statistics"`
}

// QueryJSON executes a query and returns the result parsed into the specified type
func QueryJSON[T any](ctx context.Context, client *Client, query string, opts QueryOptions) (*ClickhouseJsonResult[T], error) {
	// Ensure JSON format is set
	opts.Format = "JSON"

	// Execute the query
	response, err := client.Query(ctx, query, opts)
	if err != nil {
		return nil, fmt.Errorf("executed query: %w", err)
	}
	defer response.Body.Close()

	// Read the response body
	queryResult, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, fmt.Errorf("read response body: %w", err)
	}

	// Parse the JSON result
	var result ClickhouseJsonResult[T]
	if err := json.Unmarshal(queryResult, &result); err != nil {
		return nil, fmt.Errorf("parse JSON response: %w", err)
	}

	return &result, nil
}

// QueryJSON executes a query and returns the result parsed into the specified type
func QueryJSONFirst[T any](ctx context.Context, client *Client, query string, opts QueryOptions) (*T, error) {
	result, err := QueryJSON[T](ctx, client, query, opts)
	if err != nil {
		return nil, err
	}
	return &result.Data[0], nil
}

// getContentType returns the appropriate Content-Type header value for the given format
func getContentType(format string) string {
	switch strings.ToLower(format) {
	case "arrow":
		return "application/vnd.apache.arrow.stream"
	case "parquet":
		return "application/vnd.apache.parquet"
	case "json", "jsoneachrow", "jsoncompacteachrow", "jsonobjecteachrow":
		return "application/json"
	case "xml":
		return "application/xml"
	case "csv", "csvwithnames":
		return "text/csv"
	case "tsv", "tsvwithnames":
		return "text/tab-separated-values"
	default:
		return "text/plain"
	}
}
