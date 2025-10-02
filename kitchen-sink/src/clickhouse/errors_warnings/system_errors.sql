SELECT
    name,
    value as count,
    last_error_time::DateTime64 as last_error_time,
    last_error_message
FROM system.errors
ORDER BY value DESC
