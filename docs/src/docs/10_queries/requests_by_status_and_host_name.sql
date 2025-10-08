SELECT
    concat(substring(toString(status), 1, 1), 'xx') as statusGroup,
    host_name,
    count(*) as requests
FROM mv_caddy_accesslog
GROUP BY statusGroup, host_name
-- the ordering determines the order on the x axis, and the stacking order
ORDER BY statusGroup, host_name;