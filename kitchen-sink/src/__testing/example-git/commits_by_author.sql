SELECT
    author,
    count(*) as commit_count
FROM
    git.commits
GROUP BY
    author
ORDER BY
    commit_count DESC
LIMIT 20