-- HTTP requests grouped by 15-minute intervals and status group
SELECT
    toStartOfInterval(timestamp, INTERVAL 15 MINUTE) AS time,
    statusGroup,
    count() AS requests
FROM http_logs
GROUP BY time, statusGroup
ORDER BY time
