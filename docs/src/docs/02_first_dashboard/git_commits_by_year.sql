SELECT
    toString(toYear(time)) as year,
    count(*) as commitCount
FROM git_commits
GROUP BY year;