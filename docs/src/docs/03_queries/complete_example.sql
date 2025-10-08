-- Enable automatic bucketing based on time range
-- BUCKET: toStartOfFifteenMinutes(timestamp)::DateTime64

SELECT
    -- Time bucket with proper casting
    toStartOfFifteenMinutes(timestamp)::DateTime64 as timestamp,
    
    -- String manipulation
    replaceOne(customer_project, 'prefix.', '') as project,
    
    -- Aggregations
    count(*) as request_count,
    uniq(client_ip) as unique_ips
    
FROM mv_caddy_accesslog

WHERE
    -- Use parameters for reusable queries
    customer_tenant = {tenant:String}
    -- Global filters on 'timestamp' are applied automatically
    
GROUP BY
    timestamp,  -- Group by the alias
    project
    
ORDER BY 
    timestamp ASC,
    request_count DESC
