package clickhouse

import (
	"encoding/json"
	"testing"

	"github.com/rs/zerolog"
	"github.com/sandstorm/dashica/lib/config"
	"github.com/stretchr/testify/require"
)

func TestAssembleSchema_GroupsTheRowsByDatabaseAndTable(t *testing.T) {
	schema := assembleSchema(
		[]schemaTableRow{
			{Database: "default", Name: "http_logs", Engine: "MergeTree", EngineFull: "MergeTree PARTITION BY toDate(timestamp) ORDER BY (host, timestamp) TTL timestamp + toIntervalDay(30) SETTINGS index_granularity = 8192", SortingKey: "host, timestamp", PartitionKey: "toDate(timestamp)", PrimaryKey: "host, timestamp", Comment: "requests"},
			{Database: "default", Name: "http_logs_view", Engine: "View"},
			{Database: "system", Name: "query_log", Engine: "SystemQueryLog"},
		},
		[]schemaColumnRow{
			{Database: "default", Table: "http_logs", Name: "timestamp", Type: "DateTime64(6)"},
			{Database: "default", Table: "http_logs", Name: "day", Type: "Date", DefaultKind: "MATERIALIZED", DefaultExpression: "toDate(timestamp)", Comment: "the request's day"},
			{Database: "default", Table: "_tmp", Name: "x", Type: "UInt8"},
			{Database: "system", Table: "query_log", Name: "query", Type: "String"},
		},
		[]schemaSkipIndexRow{{Database: "default", Table: "http_logs", Name: "path_idx", Type: "bloom_filter(0.01)", Expr: "path", Granularity: 4}},
	)

	got, err := json.Marshal(schema)
	require.NoError(t, err)
	require.JSONEq(t, `{"databases": [
		{"name": "default", "tables": [
			{"name": "http_logs", "engine": "MergeTree", "sortingKey": "host, timestamp", "partitionKey": "toDate(timestamp)",
			 "primaryKey": "host, timestamp", "ttl": "timestamp + toIntervalDay(30)", "comment": "requests",
			 "columns": [
				{"name": "timestamp", "type": "DateTime64(6)", "defaultKind": "", "defaultExpression": "", "comment": ""},
				{"name": "day", "type": "Date", "defaultKind": "MATERIALIZED", "defaultExpression": "toDate(timestamp)", "comment": "the request's day"}],
			 "skipIndices": [{"name": "path_idx", "type": "bloom_filter(0.01)", "expression": "path", "granularity": 4}]},
			{"name": "http_logs_view", "engine": "View", "sortingKey": "", "partitionKey": "", "primaryKey": "", "ttl": "",
			 "comment": "", "columns": [], "skipIndices": []}]},
		{"name": "system", "tables": [
			{"name": "query_log", "engine": "SystemQueryLog", "sortingKey": "", "partitionKey": "", "primaryKey": "", "ttl": "",
			 "comment": "", "columns": [{"name": "query", "type": "String", "defaultKind": "", "defaultExpression": "", "comment": ""}],
			 "skipIndices": []}]}]}`, string(got))
}

func TestAssembleSchema_WithoutTablesHasNoDatabases(t *testing.T) {
	got, err := json.Marshal(assembleSchema(nil, nil, nil))
	require.NoError(t, err)
	require.JSONEq(t, `{"databases": []}`, string(got))
}

func TestTableTtl_IsWhatStandsBetweenTtlAndSettings(t *testing.T) {
	cases := map[string]string{
		"MergeTree ORDER BY timestamp TTL timestamp + toIntervalDay(30) SETTINGS index_granularity = 8192": "timestamp + toIntervalDay(30)",
		"MergeTree ORDER BY timestamp TTL timestamp + toIntervalDay(365)":                                  "timestamp + toIntervalDay(365)",
		"MergeTree ORDER BY timestamp TTL timestamp + toIntervalDay(7) TO VOLUME 'cold' SETTINGS a = 1":    "timestamp + toIntervalDay(7) TO VOLUME 'cold'",
		"MergeTree ORDER BY timestamp SETTINGS index_granularity = 8192":                                   "",
		"": "",
	}
	for engineFull, want := range cases {
		if got := tableTtl(engineFull); got != want {
			t.Errorf("tableTtl(%q) = %q, want %q", engineFull, got, want)
		}
	}
}

func TestManager_ConnectionsAreTheConfiguredNamesSorted(t *testing.T) {
	m := NewManager(&config.Config{ClickHouse: map[string]config.ClickHouseConfig{"default": {}, "alert_storage": {}, "logs": {}}}, zerolog.Nop())
	require.Equal(t, []string{"alert_storage", "default", "logs"}, m.Connections())
}
