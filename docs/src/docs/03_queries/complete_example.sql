-- Enable automatic bucketing based on time range
-- (opt in from Go via .With(sql.AutoBucketPlaceholder()))
SELECT
    {{DASHICA_BUCKET}}(timestamp)::DateTime64 as timestamp,
    concat(substring(toString(status), 1, 1), 'xx') as statusGroup,
    count(*) as request_count
FROM mv_caddy_accesslog

GROUP BY
    statusGroup, timestamp
ORDER BY statusGroup
