SELECT
    formatDateTime(timestamp, '%d.%m.%Y') as day,
    concat(substring(toString(status), 1, 1), 'xx') as statusGroup,
    request__method,
    count(*) as requests
FROM mv_caddy_accesslog
GROUP BY day, statusGroup, request__method
ORDER BY statusGroup ASC, any(timestamp) ASC;