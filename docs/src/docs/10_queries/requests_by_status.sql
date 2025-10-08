SELECT
    concat(substring(toString(status), 1, 1), 'xx') as statusGroup,
    count(*) as requests
FROM mv_caddy_accesslog
GROUP BY statusGroup
ORDER BY statusGroup;