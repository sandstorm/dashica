
SELECT
    database,
    table,
    name,
    type,
    data_compressed_bytes,
    data_uncompressed_bytes,
    is_in_partition_key,
    is_in_sorting_key,
    is_in_primary_key,
    is_in_sampling_key,
FROM system.columns
ORDER BY data_compressed_bytes DESC