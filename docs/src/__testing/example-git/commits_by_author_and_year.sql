-- Get top 20 authors by commit count ...
WITH top_authors AS (
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
)
-- ... join the top 20 authors from above and group all their commits by author and year.
SELECT
    c.author,
    toYear(c.time)::String as year,
        count(*) as yearly_commit_count
FROM
    git.commits c
    JOIN
        top_authors ta ON c.author = ta.author
GROUP BY
    c.author,
    year
ORDER BY
    c.author,
    year;