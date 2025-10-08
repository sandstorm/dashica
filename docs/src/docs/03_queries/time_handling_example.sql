SELECT
    toStartOfDay(timestamp::DateTime64) as timestamp,
    count(*) as request_count
FROM mv_caddy_accesslog
-- Global filters on 'timestamp' are applied automatically
GROUP BY
    timestamp
ORDER BY 
    timestamp ASC
