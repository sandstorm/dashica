```js
import hljs from 'npm:highlight.js';
```

```js
import {chart, clickhouse, component} from '/dashica/index.js';

const filters = view(component.globalFilter());
```

# Writing SQL Queries

This guide covers everything you need to know about writing and executing SQL queries in Dashica. You'll learn how to query your ClickHouse database, work with the results, use global filters and parameters, leverage automatic time bucketing, and follow best practices for writing efficient ClickHouse SQL.

Dashica uses **ClickHouse-specific SQL**, which includes powerful analytics functions and syntax optimized for large-scale data analysis. All queries are stored as `.sql` files in your project's `src/` directory and are executed live from your dashboards.

<div class="tip">

**SQL Files are Directly Runnable:** All `.sql` files in your project can be opened and executed directly in your database IDE (IntelliJ IDEA, DataGrip, or any ClickHouse client) without modification. This makes debugging straightforward—just open the file, connect to your database, and run it. No need to copy-paste or adjust the SQL.

</div>

## clickhouse.query()

The `clickhouse.query()` function is used to execute SQL queries against the Clickhouse database.

```js echo
const result = clickhouse.query(
    '/src/docs/02_first_dashboard/requests_per_day.sql',
    {filters, params: {}}
);
display(await result);
```

It returns the data in the highly efficient Apache Arrow format, which is a binary transmission format
and a columnar data format - so very well suited to big analytics data. That's why you cannot see the result
as array. You can, however, use the `.toArray()` function on the result set to convert it to an array:

```js echo
display(result.toArray());
```

<div class="warning">

If you use `.toArray()`, you'll lose the efficiency of the columnar format, as you are again converting
to a regular array (row based). Observable Plot can directly work with the columnar format, so only use
`.toArray()` for debugging or custom scenarios.

</div>

### Accessing Result Columns

When working with Apache Arrow results directly (without `.toArray()`), you can still iterate over the results:

```js echo
// Or iterate through rows
for (const row of result) {
    display(row.day, row.requests);
}
```

**All Chart components support the columnnar format natively, so usually
you do not need to convert the data to a different format (except for debugging).**

## Global Filters

The global `filters` object has the following structure:

```js
filters
```

It auto-updates if you change the global filter in the UI at the top  right - try it out!

The global filter is applied in every query where `{filters}` is given as 2nd parameter (QueryOptions).

`filters.from` and `filters.to` work on a column named `timestamp`, so **this name is a requirement for time-based data**.

Internally, this works by
setting [additional_table_filters](https://clickhouse.com/docs/operations/settings/settings#additional_table_filters).

## Time Handling

When working with time-based data in ClickHouse, it's crucial to handle timestamps correctly to ensure proper sorting, filtering, and visualization in your dashboards.

Here's a simple example that queries time-series data:

```js
const n = document.createElement('pre');
n.innerHTML = hljs.highlight(await FileAttachment("03_queries/time_handling_example.sql").text(), {language: 'sql'}).value;
display(n);
```

And here are the results of executing this query:

```js echo
display((await clickhouse.query(
    '/src/docs/03_queries/time_handling_example.sql',
    {filters, params: {}})).toArray()
);
```

- **Always cast timestamps to `::DateTime64`** - This ensures proper time handling, formatting, and compatibility with Dashica's charting components
- The `timestamp` column name is required for global filters to work automatically
- This example does NOT use automatic bucketing - it returns raw timestamps at their original granularity

For time-bucketed queries with automatic granularity adjustment, see the next section on [Automatic Time Bucketing](#automatic-time-bucketing).



## Automatic Time Bucketing

Dashica can automatically adjust the granularity of time buckets based on the selected time range to optimize query performance and visualization. This is enabled if dashica finds a `-- BUCKET:` comment in the query.

When you add a special `-- BUCKET:` comment to your query, Dashica will automatically replace the bucketing function with an appropriate granularity based on the current timespan:

```js
const n = document.createElement('pre');
n.innerHTML = hljs.highlight(await FileAttachment("03_queries/bucketing_example.sql").text(), {language: 'sql'}).value;
display(n);
```

The key points:
- The `-- BUCKET:` comment must contain the *exact SQL expression* which is used in the `SELECT` clause, because it is changed via string replacement.
- Always cast to `::DateTime64` for proper time handling
- Group by the bucket column (typically named `timestamp` or `time`)

### Available Bucket Sizes

Based on your time range width, Dashica will choose from these granularities (always using the smallest bucket that stays within ~720 buckets):

- **1 second** - `toStartOfSecond(timestamp)`
- **1 minute** - `toStartOfMinute(timestamp)`
- **5 minutes** - `toStartOfFiveMinutes(timestamp)`
- **15 minutes** - `toStartOfFifteenMinutes(timestamp)` (default in `-- BUCKET:` comment)
- **1 hour** - `toStartOfHour(timestamp)`
- **1 day** - `toStartOfDay(timestamp)`
- **1 week** - `toStartOfWeek(timestamp)`

When bucketing is active, the server includes these headers in the response:
- `X-Dashica-Bucket-Size` - The bucket size in milliseconds
- `X-Dashica-Resolved-Time-Range` - The actual time range as JSON

This is used by the UI by `timeHeatmap` and `timeHeatmapOrdinal` to display the correct bar widths.  

## SQL Query Parameters

Parameters allow building reusable queries, because the query can contain "holes" which can be filled in during
execution. This is based on
the [ClickHouse Queries with Parameters](https://clickhouse.com/docs/interfaces/http#cli-queries-with-parameters)
feature.

**Example**

    SELECT *
    FROM
        events
    WHERE
        level = {level:String}



    await clickhouse.query(
        '/content/path/to/query.sql',
        {
            filters,
            params: {level: 'error'} // <-- fill in parameters here.
        }
    );


In ClickHouse, the parameters **must be typed**; you specify
the ClickHouse data type after the colon in `{name:type}`. Arbitrary
ClickHouse types are supported, f.e.:

- `{foo:String}`
- `{foo:Nullable(String)}`
- `{foo:DateTime64}`

### Special Injected Parameters

Dashica automatically injects these parameters that you can use in your queries:

- `{__from:Int64}` - Start of the time range in seconds (Unix timestamp)
- `{__to:Int64}` - End of the time range in seconds (Unix timestamp)

**Example:**

```
SELECT
    count(*) as total_events,
    count(*) / ({__to:Int64} - {__from:Int64}) as events_per_second
FROM events
WHERE timestamp >= fromUnixTimestamp({__from:Int64})
  AND timestamp <= fromUnixTimestamp({__to:Int64})
```

These parameters are particularly useful for calculations that need the total time range, such as rates or averages over time.

### Lazy Queries

You can use the `visibility()` helper to defer query execution until a component becomes visible. This improves
performance by only running queries when their results will be displayed:

```
const data = await visibility().then(() => clickhouse.query(
    '/content/path/to/query.sql',
    {filters, params: {}}
));
```

## SQL Best Practices for Dashica

<div class="note">

**ClickHouse-Specific SQL:** All SQL in Dashica is ClickHouse-specific. Functions like `uniq()`, `arrayJoin()`, and the `::Type` casting syntax are ClickHouse features and won't work in standard SQL databases.

</div>

### Required Column Names

**`timestamp` column for time-based data**

The global time filter (`filters.from` and `filters.to`) operates on a column named `timestamp`. This is a **hard requirement** - if your time column has a different name, you must alias it:

```
SELECT
    toStartOfFifteenMinutes(event_time)::DateTime64 as timestamp,  -- Must alias to 'timestamp'
    count(*) as events
FROM my_table
GROUP BY timestamp
```

### Type Casting with `::`

ClickHouse requires explicit type casting for proper data handling. Use the `::Type` syntax:

**Timestamps - Always use `::DateTime64`**

```
-- ✅ Correct
toStartOfFifteenMinutes(timestamp)::DateTime64 as time

-- ✅ Also correct for intervals
toStartOfInterval(timestamp, INTERVAL 1 HOUR)::DateTime64 as time_bucket

-- ❌ Wrong - will cause issues with time formatting
toStartOfFifteenMinutes(timestamp) as time
```

**Enums - Cast to `::String`**

ClickHouse stores enums as integers internally. Cast them to strings to get readable values:

```
-- ✅ Correct - returns "error", "warning", "info"
log_level::String as level

-- ❌ Wrong - returns 1, 2, 3, 4
log_level as level
```

**Other Type Casts**

```
-- IP addresses
ip::String as ip_address

-- Year as string (for grouping/pivoting)
toYear(timestamp)::String as year

-- Explicit integer casting
field::Int64 as count
```

### Common ClickHouse Time Functions

```
-- Bucket functions (for automatic bucketing)
toStartOfSecond(timestamp)::DateTime64
toStartOfMinute(timestamp)::DateTime64
toStartOfFiveMinutes(timestamp)::DateTime64
toStartOfFifteenMinutes(timestamp)::DateTime64
toStartOfHour(timestamp)::DateTime64
toStartOfDay(timestamp)::DateTime64
toStartOfWeek(timestamp)::DateTime64

-- Flexible interval (useful for custom periods)
toStartOfInterval(timestamp, INTERVAL 30 MINUTE)::DateTime64
toStartOfInterval(timestamp, INTERVAL 1 MONTH)::DateTime64

-- Extract date parts
toYear(timestamp)::String
toMonth(timestamp)::String
toDayOfWeek(timestamp)::String
```

### Performance Tips

1. **Use materialized views** when possible for pre-aggregated data
2. **Limit time ranges** - avoid queries that span years without good reason
3. **Leverage ClickHouse functions** - they're optimized for analytics workloads

## Complete Example: Time-Series Query with Auto-Bucketing

Here's a complete example showing all best practices in action:

```js
const n = document.createElement('pre');
n.innerHTML = hljs.highlight(await FileAttachment("03_queries/complete_example.sql").text(), {language: 'sql'}).value;
display(n);
```

### Using the Query in a Chart

```js
const fixedColorsForErrorLevels = {
    legend: true,
    domain: ['2xx', '3xx', '4xx', '5xx', '0xx', 'other'],
    range: ['#56AF18', '#F4C83E', '#F77C39', '#D73027', '#CCCCCC', '#8E44AD'],
    unknown: '#8E44AD',
};

const data = await clickhouse.query(
    '/src/docs/03_queries/complete_example.sql',
    { filters }
);

display(chart.timeBar(data, {
    invalidation,
    x: 'timestamp',
    y: 'request_count',
    fill: 'statusGroup',
    color: fixedColorsForErrorLevels,
}));
```

This example demonstrates:
- ✅ Automatic bucketing with `-- BUCKET:` comment
- ✅ Proper `::DateTime64` casting for timestamps
- ✅ Using query parameters for reusability
- ✅ Grouping by aliased columns
- ✅ Global filters applied automatically to `timestamp` column

