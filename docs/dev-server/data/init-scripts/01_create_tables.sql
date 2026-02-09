-- Sample tables for Dashica widget examples
-- This script creates tables that are used in the dev server examples

-- HTTP access logs table
CREATE TABLE IF NOT EXISTS http_logs (
    timestamp DateTime,
    hostname String,
    method String,
    path String,
    status UInt16,
    statusGroup String,
    response_time Float64,
    bytes_sent UInt64,
    user_agent String,
    ip_address String
) ENGINE = MergeTree()
ORDER BY timestamp;

-- Metrics table for stats examples
CREATE TABLE IF NOT EXISTS metrics (
    timestamp DateTime,
    metric_name String,
    value Float64,
    tags Map(String, String)
) ENGINE = MergeTree()
ORDER BY (metric_name, timestamp);

-- Events table for general examples
CREATE TABLE IF NOT EXISTS events (
    timestamp DateTime,
    event_type String,
    event_name String,
    user_id String,
    properties Map(String, String)
) ENGINE = MergeTree()
ORDER BY (event_type, timestamp);

-- Service health status table for heatmap examples
CREATE TABLE IF NOT EXISTS service_health (
    timestamp DateTime,
    service_name String,
    status String,
    response_time Float64
) ENGINE = MergeTree()
ORDER BY (service_name, timestamp);
