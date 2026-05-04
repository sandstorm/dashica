-- Enable automatic bucketing based on time range:
-- The {{DASHICA_BUCKET}} placeholder is replaced with a ClickHouse rounding
-- function (toStartOfMinute, toStartOfHour, ...) chosen for the resolved time
-- range. Opt in from Go via .With(sql.AutoBucketPlaceholder()).
SELECT
    {{DASHICA_BUCKET}}(timestamp)::DateTime64 as timestamp,
    count(*) as request_count
FROM mv_caddy_accesslog
-- Remember: Global filters on 'timestamp' are applied automatically
GROUP BY
    timestamp
ORDER BY
    timestamp ASC
