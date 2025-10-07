SELECT
    formatDateTime(timestamp, '%d.%m.%Y') as day,
    count(*) as requests
FROM mv_caddy_accesslog
GROUP BY day
ORDER BY any(timestamp) ASC;