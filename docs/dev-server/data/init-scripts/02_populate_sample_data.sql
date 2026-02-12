-- Populate sample data for Dashica widget examples
-- This generates realistic-looking data for testing widgets

-- Sample HTTP logs (last 30 days + next 7 days for future-proof demos)
-- Generates ~150,000 requests per day with realistic day/night patterns
-- Peak hours: 10:00-11:00 and 14:00-15:00
-- Low traffic: 23:00-06:00 (night hours)
-- Total: ~5.5 million records over 37 days

INSERT INTO http_logs
SELECT
    ts,
    arrayElement(['web-01.example.com', 'web-02.example.com', 'web-03.example.com', 'api-01.example.com', 'api-02.example.com'], (number % 5) + 1) as hostname,
    arrayElement(['GET', 'POST', 'PUT', 'DELETE', 'PATCH'], (number % 5) + 1) as method,
    arrayElement(['/api/users', '/api/orders', '/api/products', '/dashboard', '/login', '/api/search', '/api/reports'], (number % 7) + 1) as path,
    arrayElement([200, 200, 200, 200, 201, 204, 301, 400, 404, 500, 502, 503], (number % 12) + 1) as status,
    arrayElement(['2xx', '2xx', '2xx', '2xx', '2xx', '3xx', '4xx', '4xx', '5xx', '5xx'], (number % 10) + 1) as statusGroup,
    (rand() % 1000) / 10.0 as response_time,
    (rand() % 100000) + 1000 as bytes_sent,
    arrayElement(['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'curl/7.68.0', 'PostmanRuntime/7.28.0'], (number % 4) + 1) as user_agent,
    concat('192.168.', toString((number % 255) + 1), '.', toString((rand() % 255) + 1)) as ip_address
FROM (
    SELECT
        now() - INTERVAL (30 * 24 * 60) MINUTE + INTERVAL number MINUTE as ts,
        number
    FROM numbers(37 * 24 * 60)  -- All minutes in 37 days
) AS time_slots
ARRAY JOIN
    -- Generate multiple records per minute based on hour of day
    -- Night hours (23-06): 1-3 requests/min
    -- Morning hours (07-09): 5-8 requests/min
    -- Peak morning (10-11): 10-15 requests/min
    -- Midday (12-13): 7-10 requests/min
    -- Peak afternoon (14-15): 10-15 requests/min
    -- Evening (16-22): 6-9 requests/min
    range(1,
        multiIf(
            toHour(ts) >= 23 OR toHour(ts) < 6, (rand() % 3) + 1,  -- Night: 1-3
            toHour(ts) >= 6 AND toHour(ts) < 9, (rand() % 4) + 5,   -- Morning: 5-8
            toHour(ts) >= 9 AND toHour(ts) < 12, (rand() % 6) + 10, -- Peak AM: 10-15
            toHour(ts) >= 12 AND toHour(ts) < 14, (rand() % 4) + 7, -- Lunch: 7-10
            toHour(ts) >= 14 AND toHour(ts) < 16, (rand() % 6) + 10,-- Peak PM: 10-15
            (rand() % 4) + 6                                         -- Evening: 6-9
        )
    ) AS number;

-- Sample metrics (last 7 days + next 1 day)
-- Generates metrics every minute for 10 servers
-- CPU/memory usage follows load patterns (higher during day)
-- Total: ~115,000 records over 8 days

INSERT INTO metrics
SELECT
    ts,
    metric_name,
    -- Values vary based on time of day and metric type
    CASE metric_name
        WHEN 'cpu_usage' THEN
            -- CPU higher during peak hours
            multiIf(
                toHour(ts) >= 0 AND toHour(ts) < 6, (rand() % 20) + 10,   -- Night: 10-30%
                toHour(ts) >= 6 AND toHour(ts) < 9, (rand() % 30) + 30,   -- Morning: 30-60%
                toHour(ts) >= 9 AND toHour(ts) < 17, (rand() % 40) + 50,  -- Peak: 50-90%
                (rand() % 30) + 30                                         -- Evening: 30-60%
            )
        WHEN 'memory_usage' THEN
            -- Memory more stable, slight increase during day
            multiIf(
                toHour(ts) >= 9 AND toHour(ts) < 17, (rand() % 20) + 60,  -- Peak: 60-80%
                (rand() % 20) + 50                                         -- Other: 50-70%
            )
        WHEN 'disk_usage' THEN
            -- Disk usage grows slowly over time
            ((toRelativeSecondNum(ts) % (7 * 24 * 3600)) * 100 / (7 * 24 * 3600)) + (rand() % 5)
        WHEN 'requests_per_minute' THEN
            -- Follows similar pattern to HTTP logs
            multiIf(
                toHour(ts) >= 0 AND toHour(ts) < 6, (rand() % 20) + 5,    -- Night: 5-25
                toHour(ts) >= 9 AND toHour(ts) < 17, (rand() % 100) + 100,-- Peak: 100-200
                (rand() % 50) + 40                                         -- Other: 40-90
            )
        WHEN 'error_rate' THEN
            -- Low error rate, occasional spikes
            if((rand() % 100) < 95, (rand() % 3), (rand() % 20) + 10)
        ELSE (rand() % 100)
    END as value,
    map('host', concat('server-', toString((number % 10) + 1)), 'environment', 'production') as tags
FROM (
    SELECT
        now() - INTERVAL (7 * 24 * 60) MINUTE + INTERVAL number MINUTE as ts,
        number
    FROM numbers(8 * 24 * 60)  -- All minutes in 8 days
) AS time_slots
ARRAY JOIN
    ['cpu_usage', 'memory_usage', 'disk_usage', 'requests_per_minute', 'error_rate'] AS metric_name
ARRAY JOIN
    range(10) AS number;  -- 10 servers

-- Sample events (last 30 days + next 7 days)
-- Generates ~200,000 events per day with realistic day/night patterns
-- More user activity during daytime, less at night
-- Total: ~7.4 million records over 37 days

INSERT INTO events
SELECT
    ts,
    arrayElement(['user_action', 'system_event', 'error', 'purchase'], (number % 4) + 1) as event_type,
    arrayElement(['page_view', 'button_click', 'form_submit', 'login', 'logout', 'purchase_complete'], (number % 6) + 1) as event_name,
    concat('user_', toString((rand() % 5000) + 1)) as user_id,  -- Increased user pool
    map('page', concat('/page/', toString(number % 20)), 'session_id', toString(rand())) as properties
FROM (
    SELECT
        now() - INTERVAL (30 * 24 * 60) MINUTE + INTERVAL number MINUTE as ts,
        number
    FROM numbers(37 * 24 * 60)  -- All minutes in 37 days
) AS time_slots
ARRAY JOIN
    -- User events follow similar but slightly different patterns than HTTP logs
    -- Night hours (00-06): 2-5 events/min
    -- Morning (07-09): 10-15 events/min
    -- Peak hours (10-16): 15-25 events/min
    -- Evening (17-23): 8-12 events/min
    range(1,
        multiIf(
            toHour(ts) >= 0 AND toHour(ts) < 6, (rand() % 4) + 2,   -- Night: 2-5
            toHour(ts) >= 6 AND toHour(ts) < 10, (rand() % 6) + 10, -- Morning: 10-15
            toHour(ts) >= 10 AND toHour(ts) < 16, (rand() % 11) + 15,-- Peak: 15-25
            (rand() % 5) + 8                                         -- Evening: 8-12
        )
    ) AS number;

-- Sample service health (last 7 days + next 1 day, every 5 minutes)
INSERT INTO service_health
SELECT
    now() - INTERVAL (7 * 24 * 60) MINUTE + INTERVAL number * 5 MINUTE as timestamp,
    arrayElement(['api-service', 'database', 'cache', 'queue', 'auth-service', 'notification-service'], (number % 6) + 1) as service_name,
    arrayElement(['healthy', 'healthy', 'healthy', 'degraded', 'down'],
                 if((rand() % 100) > 95, 5, if((rand() % 100) > 85, 4, (number % 3) + 1))) as status,
    (rand() % 500) / 10.0 as response_time
FROM numbers(2304);  -- 8 days * 24 hours * 12 (every 5 minutes)
