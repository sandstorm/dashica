-- Enable automatic bucketing based on time range:
-- the system will replace the SQL query part via search/replace depending on the chosen time range.
-- BUCKET: toStartOfFifteenMinutes(timestamp)::DateTime64
SELECT
    -- this toStartOfFifteenMinutes() function will be replaced by the system
    -- depending on the chosen time range
    toStartOfFifteenMinutes(timestamp)::DateTime64 as timestamp,
    count(*) as request_count
FROM mv_caddy_accesslog
-- Remember: Global filters on 'timestamp' are applied automatically
GROUP BY
    timestamp
ORDER BY 
    timestamp ASC
