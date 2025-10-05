-- taken from https://clickhouse.com/docs/getting-started/example-datasets/github#downloading-and-inserting-the-data


CREATE TABLE git_commits
(
    hash String,
    author LowCardinality(String),
    time DateTime,
    message String,
    files_added UInt32,
    files_deleted UInt32,
    files_renamed UInt32,
    files_modified UInt32,
    lines_added UInt32,
    lines_deleted UInt32,
    hunks_added UInt32,
    hunks_removed UInt32,
    hunks_changed UInt32
) ENGINE = MergeTree ORDER BY time;

INSERT INTO git_commits SELECT *
FROM s3('https://datasets-documentation.s3.amazonaws.com/github/commits/clickhouse/commits.tsv.xz', 'TSV', 'hash String,author LowCardinality(String), time DateTime, message String, files_added UInt32, files_deleted UInt32, files_renamed UInt32, files_modified UInt32, lines_added UInt32, lines_deleted UInt32, hunks_added UInt32, hunks_removed UInt32, hunks_changed UInt32')

