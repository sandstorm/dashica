SELECT
    toStartOfFifteenMinutes(timestamp)::DateTime64 as time,
    count(*) as log_count
FROM
    full_logs
WHERE
      event_dataset = {event_dataset:String}
  AND toDate(timestamp) = {date:String}
GROUP BY
    time
ORDER BY
    time ASC;