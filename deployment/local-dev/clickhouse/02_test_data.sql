-- ClickHouse query to read from multiple parquet files
-- Each parquet file will be associated with a specific dataset

DELETE
FROM
    full_logs
WHERE
    true;


INSERT INTO full_logs
WITH
    parquet_dataset_mapping AS (
        SELECT
            file_path,
            dataset_name
        FROM
            (
                SELECT
                    '/var/lib/clickhouse/user_files/test_prod_dumps/shop_order_failures_2025-03-20.parquet' AS file_path,
                    'order_failures'                                                                        AS dataset_name
                )), (
    -- Define arrays of sample values for each low-cardinality field
                     ['Sandstorm', 'CloudNine', 'Avalanche', 'BlueSky', 'RedOcean'] AS tenants,
                     ['Website', 'API', 'Backend', 'Mobile', 'Analytics'] AS projects,
                     ['K3S2021', 'AWS2022', 'GCP2023', 'AZR2023', 'OCI2024'] AS host_groups,
                     ['srv-01', 'srv-02', 'srv-03', 'srv-04', 'srv-05'] AS host_names,
                     ['flow', 'auth', 'database', 'cache', 'network'] AS modules,
                     ['access', 'error', 'performance', 'security', 'system'] AS log_types,
                     ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'panic', 'NoLevel'] AS log_levels,
    -- Sample log messages based on different levels
                     [
                         'Successfully processed request in {}ms',
                         'Database query executed in {}ms',
                         'User {} logged in successfully',
                         'Cache miss for key: {}',
                         'Request from IP {} received',
                         'Slow query detected: {}',
                         'Connection timeout after {}ms',
                         'Failed to connect to service: {}',
                         'Invalid authentication attempt from IP: {}',
                         'Out of memory error in module: {}'
                         ] AS message_templates,
    -- Sample JSON payloads for event_original
                     [
                         '{"request_id": "{}", "user_agent": "Mozilla/5.0", "path": "/api/users", "method": "GET", "status": 200}',
                         '{"request_id": "{}", "user_agent": "Chrome/91.0", "path": "/dashboard", "method": "POST", "status": 201}',
                         '{"request_id": "{}", "user_agent": "PostmanRuntime/7.28.0", "path": "/auth/login", "method": "POST", "status": 401}',
                         '{"request_id": "{}", "user_agent": "curl/7.68.0", "path": "/metrics", "method": "GET", "status": 200}',
                         '{"request_id": "{}", "user_agent": "Python-requests/2.25.1", "path": "/api/data", "method": "PUT", "status": 500}'
                         ] AS json_templates
    )

SELECT
    -- Use row number for deterministic distribution of values
    tenants[(rowNumberInAllBlocks() % length(tenants)) + 1]               AS customer_tenant,
    concat(tenants[(rowNumberInAllBlocks() % length(tenants)) + 1], '.',
           projects[(rowNumberInAllBlocks() % length(projects)) + 1])     AS customer_project,
    host_groups[((rowNumberInAllBlocks() * 7) % length(host_groups)) + 1] AS host_group,
    host_names[((rowNumberInAllBlocks() * 13) % length(host_names)) + 1]  AS host_name,
    modules[((rowNumberInAllBlocks() * 3) % length(modules)) + 1]         AS event_module,

    -- Use dataset from mapping instead of random generation
    source_data.dataset_name                                              AS event_dataset,

    -- Use timestamp directly from the parquet file
    source_data.timestamp,

    -- Create log message by replacing placeholder with a deterministic value
    replaceOne(
            message_templates[((rowNumberInAllBlocks() * 17) % length(message_templates)) + 1],
            '{}',
            toString(100 + (rowNumberInAllBlocks() % 900))
    )                                                                     AS message,

    -- Distribute log levels with higher frequency of info and lower frequency of fatal/panic
    CASE
        WHEN (rowNumberInAllBlocks() % 100) == 0 THEN 'panic'
        WHEN (rowNumberInAllBlocks() % 100) == 1 THEN 'fatal'
        WHEN (rowNumberInAllBlocks() % 100) >= 2 AND (rowNumberInAllBlocks() % 100) <= 11 THEN 'error'
        WHEN (rowNumberInAllBlocks() % 100) >= 12 AND (rowNumberInAllBlocks() % 100) <= 21 THEN 'warn'
        WHEN (rowNumberInAllBlocks() % 100) >= 22 AND (rowNumberInAllBlocks() % 100) <= 51 THEN 'info'
        WHEN (rowNumberInAllBlocks() % 100) >= 52 AND (rowNumberInAllBlocks() % 100) <= 71 THEN 'debug'
        WHEN (rowNumberInAllBlocks() % 100) >= 72 AND (rowNumberInAllBlocks() % 100) <= 81 THEN 'trace'
        ELSE 'NoLevel'
        END                                                               AS level,

    -- Only add duration for certain types of messages (about 70% of entries)
    CASE
        WHEN rowNumberInAllBlocks() % 10 < 7 THEN 5 + (rowNumberInAllBlocks() % 1000)
        ELSE NULL
        END                                                               AS event_duration_ms,

    -- Generate JSON data for event_original
    replaceOne(
            json_templates[((rowNumberInAllBlocks() * 31) % length(json_templates)) + 1],
            '{}',
            toString(formatDateTime(source_data.timestamp, '%Y%m%d%H%M%S')) || '-' || toString(rowNumberInAllBlocks())
    )                                                                     AS event_original

-- Join with the mapping to process each file with its corresponding dataset
FROM
    (
        SELECT *,
               'shop_order_failures' AS dataset_name
        FROM
            file('/var/lib/clickhouse/user_files/test_prod_dumps/shop_order_failures_*.parquet', Parquet)

        UNION ALL
        SELECT *,
               'shop_successful_orders' AS dataset_name
        FROM
            file('/var/lib/clickhouse/user_files/test_prod_dumps/shop_successful_orders_*.parquet', Parquet)
        ) AS source_data