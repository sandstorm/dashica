SELECT
    concat(substring(toString(status), 1, 1), 'xx') as label,
    IF(label = '2xx', 'forestgreen',
       IF(label = '5xx', 'crimson', 'orange')) as color,
    COUNT(*)::Int32 as value
FROM mv_caddy_accesslog
GROUP BY label
ORDER BY label
