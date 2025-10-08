-- src/02_first_dashboard/requests_per_day.sql
SELECT
    formatDateTime(timestamp, '%d.%m.%Y') as day,
    count(*) as requests
FROM mv_caddy_accesslog
GROUP BY day
ORDER BY any(timestamp) ASC;