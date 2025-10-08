SELECT
    concat(substring(toString(status), 1, 1), 'xx') as statusGroup,
    -- calculate a color based on the statusGroup
    concat('hsl(110deg 60% ', (cityHash64(host_name) % 100), '%)') as statusGroupColor,
    host_name,
    count(*) as requests
FROM mv_caddy_accesslog
GROUP BY statusGroup, statusGroupColor, host_name
ORDER BY statusGroup, host_name;