DROP TABLE IF EXISTS dashica_alert_events;
CREATE TABLE dashica_alert_events
(
    alert_id_group         LowCardinality(String),
    alert_id_key           LowCardinality(String),
    timestamp              DateTime,

    status                 Enum ('unknown' = 1, 'OK' = 2, 'warn' = 3, 'error' = 4),
    -- alert_result_timestamp Nullable(Datetime),
    message                Nullable(String),
    -- auto_resolve_on        Nullable(DateTime)
) ENGINE = MergeTree() PARTITION BY toYYYYMMDD(timestamp)
      ORDER BY (alert_id_group, alert_id_key, timestamp)
      -- we store the alert events WAY LONGER than our normal viewing interval,
      -- to be relatively certain that ALWAYS an event exists with old history.
      TTL timestamp + INTERVAL 365 DAY
          DELETE
      SETTINGS index_granularity = 8192;