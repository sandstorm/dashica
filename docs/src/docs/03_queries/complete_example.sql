-- Enable automatic bucketing based on time range
-- BUCKET: toStartOfFifteenMinutes(timestamp)::DateTime64
SELECT
    -- Time bucket with proper casting
    toStartOfFifteenMinutes(timestamp)::DateTime64 as timestamp,
    concat(substring(toString(status), 1, 1), 'xx') as statusGroup,
    count(*) as request_count
FROM mv_caddy_accesslog

GROUP BY
    statusGroup, timestamp
ORDER BY statusGroup
