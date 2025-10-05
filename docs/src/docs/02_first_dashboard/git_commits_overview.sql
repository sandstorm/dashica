SELECT
    toString(toYear(time)) as year,
    count(*) as commitCount
FROM git.commits
GROUP BY year;