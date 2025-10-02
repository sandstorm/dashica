--BUCKET: toStartOfFifteenMinutes(--NOW--)
SELECT
    toStartOfFifteenMinutes(timestamp)::DateTime64 as time,
    toUnixTimestamp(time) as time_ts,
    count(*) as value
FROM
    full_logs
WHERE
    event_dataset = {event_dataset:String}
GROUP BY
    time
        --HAVING-- time=--BUCKET--
ORDER BY
    time ASC
