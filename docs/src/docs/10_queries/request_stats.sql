SELECT
    'Total Requests' as label,
    COUNT(*)::Int32 as value
FROM mv_caddy_accesslog
