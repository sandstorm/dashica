-- Populate sample data for Dashica widget examples
-- This generates realistic-looking data for testing widgets

-- Sample HTTP logs (last 30 days + next 7 days for future-proof demos)
INSERT INTO http_logs
SELECT
    now() - INTERVAL (30 * 24 * 60) MINUTE + INTERVAL number % (37 * 24 * 60) MINUTE as timestamp,
    arrayElement(['web-01.example.com', 'web-02.example.com', 'web-03.example.com', 'api-01.example.com', 'api-02.example.com'], (number % 5) + 1) as hostname,
    arrayElement(['GET', 'POST', 'PUT', 'DELETE', 'PATCH'], (number % 5) + 1) as method,
    arrayElement(['/api/users', '/api/orders', '/api/products', '/dashboard', '/login', '/api/search', '/api/reports'], (number % 7) + 1) as path,
    arrayElement([200, 200, 200, 200, 201, 204, 301, 400, 404, 500, 502, 503], (number % 12) + 1) as status,
    arrayElement(['2xx', '2xx', '2xx', '2xx', '2xx', '3xx', '4xx', '4xx', '5xx', '5xx'], (number % 10) + 1) as statusGroup,
    (rand() % 1000) / 10.0 as response_time,
    (rand() % 100000) + 1000 as bytes_sent,
    arrayElement(['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'curl/7.68.0', 'PostmanRuntime/7.28.0'], (number % 4) + 1) as user_agent,
    concat('192.168.', toString((number % 255) + 1), '.', toString((rand() % 255) + 1)) as ip_address
FROM numbers(50000);

-- Sample metrics (last 7 days + next 1 day)
INSERT INTO metrics
SELECT
    now() - INTERVAL (7 * 24 * 60) MINUTE + INTERVAL number % (8 * 24 * 60) MINUTE as timestamp,
    arrayElement(['cpu_usage', 'memory_usage', 'disk_usage', 'requests_per_minute', 'error_rate'], (number % 5) + 1) as metric_name,
    (rand() % 100) as value,
    map('host', concat('server-', toString((number % 10) + 1)), 'environment', 'production') as tags
FROM numbers(10000);

-- Sample events (last 30 days + next 7 days)
INSERT INTO events
SELECT
    now() - INTERVAL (30 * 24 * 60) MINUTE + INTERVAL number % (37 * 24 * 60) MINUTE as timestamp,
    arrayElement(['user_action', 'system_event', 'error', 'purchase'], (number % 4) + 1) as event_type,
    arrayElement(['page_view', 'button_click', 'form_submit', 'login', 'logout', 'purchase_complete'], (number % 6) + 1) as event_name,
    concat('user_', toString((number % 1000) + 1)) as user_id,
    map('page', concat('/page/', toString(number % 20)), 'session_id', toString(rand())) as properties
FROM numbers(100000);

-- Sample service health (last 7 days + next 1 day, every 5 minutes)
INSERT INTO service_health
SELECT
    now() - INTERVAL (7 * 24 * 60) MINUTE + INTERVAL number * 5 MINUTE as timestamp,
    arrayElement(['api-service', 'database', 'cache', 'queue', 'auth-service', 'notification-service'], (number % 6) + 1) as service_name,
    arrayElement(['healthy', 'healthy', 'healthy', 'degraded', 'down'],
                 if((rand() % 100) > 95, 5, if((rand() % 100) > 85, 4, (number % 3) + 1))) as status,
    (rand() % 500) / 10.0 as response_time
FROM numbers(2304);  -- 8 days * 24 hours * 12 (every 5 minutes)
