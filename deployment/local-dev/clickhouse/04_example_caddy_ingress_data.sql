DROP TABLE IF EXISTS `mv_caddy_accesslog`;
CREATE TABLE mv_caddy_accesslog
(
    `customer_tenant` LowCardinality(String) COMMENT 'e.g. "Sandstorm" -  for Kubernetes, this is the K8S Namespace. This is a very important selection criterion' CODEC(ZSTD(3)),
    `customer_project` LowCardinality(String) COMMENT 'e.g. "Sandstorm.Website" - for Kubernetes, this is the Namespace + App Label' CODEC(ZSTD(3)),
    `host_group` LowCardinality(String) COMMENT 'e.g. "K3S2021" (Logical Infrastructure Name)' CODEC(ZSTD(3)),
    `host_name` LowCardinality(String) COMMENT 'the hostname itself' CODEC(ZSTD(3)),
    `timestamp` DateTime64(6) COMMENT 'The UNIX timestamp with Microsecond precision. Created where this log message was originally created from; and relevant because we need a total ordering which reflected the original order.' CODEC(DoubleDelta, ZSTD(3)),
    `request__method` LowCardinality(String),
    `status` UInt16
)
    ENGINE = MergeTree
    ORDER BY (customer_tenant, customer_project, host_group, host_name, timestamp)
SETTINGS index_granularity = 8192;


INSERT INTO mv_caddy_accesslog
SELECT
    customer_tenant,
    customer_project,
    host_group,
    host_name,
    timestamp
        + INTERVAL (multiplier * 30 + (rand(toUInt64(timestamp) + multiplier) % 30)) SECOND
        + INTERVAL (rand(toUInt64(timestamp) + multiplier + 999) % 1000000) MICROSECOND
        -- 2025-10-07 17:00:00 was approximately the time when the snapshot was taken
        + INTERVAL (NOW() - toDateTime('2025-10-07 17:00:00')) SECOND
    as timestamp,
    request__method,
    status
FROM file('/var/lib/clickhouse/user_files/test_prod_dumps/caddy_ingress_2025-10-07.parquet', Parquet)
     ARRAY JOIN range(10) as multiplier
    SETTINGS max_insert_threads = 4;

SELECT count(*), count(DISTINCT timestamp)
FROM mv_caddy_accesslog;


