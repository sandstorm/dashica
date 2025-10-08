SELECT
    concat(substring(toString(status), 1, 1), 'xx') as label,
    count(*)::Int32 as value
FROM mv_caddy_accesslog
GROUP BY label
ORDER BY label;