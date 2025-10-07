SELECT
    formatDateTime(timestamp, '%d.%m.%Y') as day,
    concat(substring(toString(status), 1, 1), 'xx') as statusGroup,
    count(*) as requests
FROM mv_caddy_accesslog
GROUP BY day, statusGroup
ORDER BY statusGroup ASC, any(timestamp) ASC;