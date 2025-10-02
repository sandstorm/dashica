
SELECT
    table,
    sum(rows) AS rows,
    max(modification_time) AS latest_modification,
    formatReadableSize(sum(bytes)) AS data_size_readable,
    formatReadableSize(sum(primary_key_bytes_in_memory)) AS primary_keys_size,
    any(engine) AS engine,
    formatReadableSize(sum(data_uncompressed_bytes)) AS total_data_uncompressed_bytes,
    round(sum(data_compressed_bytes) / sum(data_uncompressed_bytes), 3) AS compression_ratio,
    sum(bytes) AS bytes_size
FROM system.parts
WHERE active
GROUP BY
    database,
    table
ORDER BY bytes_size DESC