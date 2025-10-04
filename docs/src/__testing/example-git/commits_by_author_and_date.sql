SELECT
    toStartOfInterval(time, INTERVAL 1 MONTH)::DateTime64 as time_bucket, author,
    count(*) as commit_count
FROM
    git.commits
GROUP BY
    time_bucket,
    author
ORDER BY author, time_bucket
