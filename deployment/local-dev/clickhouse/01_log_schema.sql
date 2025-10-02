-- `full_logs`
DROP TABLE IF EXISTS `full_logs`;
CREATE TABLE full_logs
(
    `customer_tenant` LowCardinality(String) COMMENT 'e.g. "Sandstorm" -  for Kubernetes, this is the K8S Namespace. This is a very important selection criterion' CODEC(ZSTD(3)),
    `customer_project` LowCardinality(String) COMMENT 'e.g. "Sandstorm.Website" - for Kubernetes, this is the Namespace + App Label' CODEC(ZSTD(3)),
    `host_group` LowCardinality(String) COMMENT 'e.g. "K3S2021" (Logical Infrastructure Name)' CODEC(ZSTD(3)),
    `host_name` LowCardinality(String) COMMENT 'the hostname itself' CODEC(ZSTD(3)),
    `event_module` LowCardinality(String) COMMENT 'Name of the module this data is coming from, f.e. "flow" - inspired by https://www.elastic.co/guide/en/ecs/current/ecs-event.html#field-event-module' CODEC(ZSTD(3)),
    `event_dataset` LowCardinality(String) COMMENT 'If an event source publishes more than one type of log or events (e.g. access log, error log), the dataset is used to specify which one the event comes from. f.e. "nginx.access" - inspired by https://www.elastic.co/guide/en/ecs/current/ecs-event.html#field-event-dataset' CODEC(ZSTD(3)),
    `timestamp` DateTime64(6) COMMENT 'The UNIX timestamp with Microsecond precision. Created where this log message was originally created from; and relevant because we need a total ordering which reflected the original order.' CODEC(DoubleDelta, ZSTD(3)),
    `message` String COMMENT 'the log message, optimized for viewing in a log viewer. Plain text, inspired by https://www.elastic.co/guide/en/ecs/current/ecs-base.html#field-message' CODEC(ZSTD(3)),
    `level` Enum8('trace' = -1, 'debug' = 0, 'info' = 1, 'warn' = 2, 'error' = 3, 'fatal' = 4, 'panic' = 5, 'NoLevel' = 6) DEFAULT 'NoLevel' COMMENT 'the log level, modeled after https://github.com/rs/zerolog/blob/master/log.go#L114',
    `event_duration_ms` Nullable(Int32) COMMENT 'log messages which represent a *duration* (i.e. a request/response cycle) should have this field set. We store integers in milliseconds, because that is precise enough for us and enables easy analytics. Inspired by https://www.elastic.co/guide/en/ecs/current/ecs-event.html#field-event-duration' CODEC(DoubleDelta, ZSTD(3)),
    `event_original` String COMMENT 'The full log message as taken from Vector.dev with all fields - in JSON. Inspired by https://www.elastic.co/guide/en/ecs/current/ecs-event.html#field-event-original' CODEC(ZSTD(3))
)
    ENGINE = MergeTree
    ORDER BY (customer_tenant, customer_project, host_group, host_name, event_module, event_dataset, timestamp)
    # we SKIP the prod TTL here, to keep the fixture data indefinitely :)
SETTINGS index_granularity = 8192;
