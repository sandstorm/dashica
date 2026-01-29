--BUCKET: toStartOfFifteenMinutes(--NOW--)
SELECT
    toUnixTimestamp(toStartOfFifteenMinutes(timestamp)) as time,
    count(*) as value
FROM
    full_logs
WHERE
      event_dataset = {event_dataset:String}
GROUP BY
    time
--HAVING-- time=--BUCKET--
ORDER BY
    time ASC;