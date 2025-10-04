<!--
TO UPDATE THE README: edit it in README.template.md and run `dev gen-readme`
- this will pull in examples automatically. 
--> 

{{ define "extractSection" }}
{{- $sectionId := . -}}
{{- $pattern := printf "<!-- SECTION id=%s -->([\\s\\S]*?)<!-- SECTION:end -->" $sectionId -}}
{{- $found := (file.Read "app/client/content/__testing/example-git.md" | regexp.Find $pattern) -}}
{{- $found -}}
{{ end }}

# Dashica

Sandstorm Monitoring Dashboards and Alerting, based on Observable Framework and Observable Plot, for any
ClickHouse Database.

A code-first Grafana alternative.

Main Features and ideas:

- flexible dashboards, configured in Markdown / Code / Git.
- works specifically with ClickHouse
- supporting arbitrary SQL for graphs and alerts
- no magic calculations in the Graphing layer; SQL result values are directly printed
- Alerts easily debuggable and automatically visualized
- global time and SQL selector, persisted to URL parameters
- adjustable chart colors, f.e. for keeping "OK" bars green and "error" bars red.
- ...

<!-- TOC -->
* [Dashica](#dashica)
* [Development](#development)
  * [Development Setup](#development-setup-)
  * [Running Tests](#running-tests)
  * [Development Cookbook / Tips and Tricks](#development-cookbook--tips-and-tricks)
    * [Starting from Scratch again / dropping all data in the container](#starting-from-scratch-again--dropping-all-data-in-the-container)
    * [Updating README](#updating-readme)
    * [==(your topic here)==](#your-topic-here)
* [User Manual](#user-manual)
  * [system configuration using `dashica_config.yaml`](#system-configuration-using-dashica_configyaml)
  * [Developing Dashboards](#developing-dashboards)
  * [Queries](#queries)
    * [Query Results should be Tidy Data](#query-results-should-be-tidy-data)
    * [Global Filters](#global-filters)
    * [Lazy Queries](#lazy-queries)
    * [SQL Do's and Don'ts](#sql-dos-and-donts)
    * [SQL Query Parameters](#sql-query-parameters)
  * [Chart Types](#chart-types)
    * [Understanding Data Types](#understanding-data-types)
    * [Use the following rules to decide which chart type to use:](#use-the-following-rules-to-decide-which-chart-type-to-use)
    * [Common Chart Options](#common-chart-options)
    * [barVertical](#barvertical)
    * [barHorizontal](#barhorizontal)
    * [timeBar](#timebar)
    * [TODO: timeHeatmap](#todo-timeheatmap)
    * [TODO: timeHeatmapOrdinal](#todo-timeheatmapordinal)
    * [TODO: stats](#todo-stats)
    * [Table view with search and details](#table-view-with-search-and-details)
  * [Advanced Chart Examples](#advanced-chart-examples)
    * [pinning colors (ok, warn, error, ...)](#pinning-colors-ok-warn-error-)
    * [deciding on colors in SQL](#deciding-on-colors-in-sql)
    * [comparison this vs last week](#comparison-this-vs-last-week)
    * [TODO: custom chart types](#todo-custom-chart-types)
    * [Collapsible Sections](#collapsible-sections)
  * [Alerting](#alerting)
    * [Alert Configuration](#alert-configuration)
    * [Configuration Fields](#configuration-fields)
    * [SQL Query Format](#sql-query-format)
    * [Important Query Elements](#important-query-elements)
    * [Alert Conditions](#alert-conditions)
    * [Alert Examples: HTTP Error Alert](#alert-examples-http-error-alert)
    * [Development vs. Production](#development-vs-production)
    * [Creating a New Alert](#creating-a-new-alert)
  * [Best Practices](#best-practices)
  * [-----------](#-----------)
* [Production Setup](#production-setup)
  * [-----------](#------------1)
* [Architecture](#architecture)
* [Thanks to](#thanks-to)
<!-- TOC -->

# Development

## Development Setup 

Prerequisites:

- Docker Compose

Get started:

```bash
# at root of repo:
dev setup

# follow instructions
```

## Running Tests

```bash

# run all unit tests
dev tests_run_all
```

The test setup is a bit intricate, as shown by the image below:

- The main idea is to base the tests on **real incidents**. For data privacy reasons, we only extract the **event
  timestamps**
  from the incident and not the event payload. This usually is enough because alerts normally are based on counting
  events in
  a timeframe.
- there exists tooling for **downloading incident data** from prod - described
  at http://127.0.0.1:8080/content/__testing/test-data
  (which is the rendered version of [test-data.md](app/client/content/__testing/test-data.md)). This is **ALSO used for
  visualizing** the shape and volume of the data - extremely helpful for writing and debugging tests.

```
┌──────────────────────────────────┐                                                                                                           
│          E2E testcases           │───────────────────────────────┐                                                                           
└──────────────────────────────────┘                      load and │                                                                           
                  │use                                     execute ▼                                                                           
                  ▼                              ┌──────────────────────────────────┐                                                          
┌──────────────────────────────────┐             │    alerts.yaml + SQL queries     │                                    _____ ___ ___ _____   
│   dashica_config_testing.yaml    │             │  server/alerting/test_fixtures/  │─ ─ ─ ┐ builds on fixture          |_   _| __/ __|_   _|  
└──────────────────────────────────┘             └──────────────────────────────────┘        data for the                 | | | _|\__ \ | |    
                  │default: use                                                            │ different testcases          |_| |___|___/ |_|    
                  │the local DB                                                            ▼                                                   
                  ▼                                                ┌───────────────────────────────────────────────┐                           
┌──────────────────────────────────┐          imported via         │                   FIXTURES                    │                           
│            CLICKHOUSE            │  /docker_entrypoint_initdb.d  │deployment/local_dev/clickhouse/test_prod_dumps│                           
│        docker-compose.yml        │◀──────────────────────────────│                  /*.parquet                   ╠═════════════════════════
└──────────────────────────────────┘                               │  contains event timestamps of real incidents  │                           
                  ▲                                                └───────────────────────────────────────────────┘       ___  _____   __     
                  │ alert_target:                                                          ▲                              |   \| __\ \ / /     
                  │ use the local DB                                              visualize│                              | |) | _| \ V /      
┌──────────────────────────────────┐                         ┌──────────────────────────────────────────────────────────┐ |___/|___| \_/       
│       dashica_config.yaml        │                         │     Dev Dashboard for visualizing the fixtures (with     │                      
└──────────────────────────────────┘                         │  explanations); helpful for test creation and debugging  │                      
                                                             │    http://127.0.0.1:8080/content/__testing/test-data     │                      
                                                             └──────────────────────────────────────────────────────────┘                      
```

## Development Cookbook / Tips and Tricks

In this section, we collect various tips and tricks for specific situations.

### Starting from Scratch again / dropping all data in the container

```bash
# remove all containers; reset database state
docker compose down -v -t0

# remove all untracked files (dry run - does NOT delete anything)
git clean -X -n
# remove all untracked files
git clean -X -f
```

### Updating README

update `README.template.md`, then run `dev gen-readme` to update README.md. This will pull in code snippets from
`app/src/content/__testing/example-git.md` via gomplate to README.md.

### ==(your topic here)==

==e.g.==

- ==running importers==
- ==executing database migrations==
- ==compiling CSS/JS==
- ==debugging==
- ==sending mails or debugging mail sending==

# User Manual

## Project Setup

TODO describe package.json setup, dashica_config.yaml, and observablehq.config.js

## system configuration using `dashica_config.yaml`

TODO write me

## Developing Dashboards

All dashboards (which are created via markdown files) should have the following header in a `js` fenced code block:

```js
import {chart, clickhouse, component} from '/lib/index.js';

const schema = await clickhouse.schema();

display(component.globalTimeSelector.markup);
const timeSelectorValues = component.globalTimeSelector.currentValues;

const sqlFilter = view(component.sqlFilterInput(schema));
const viewOptions = view(component.viewOptions());
```

This header initializes the dashboard by:

- Importing core modules (chart, clickhouse, component)
- Setting up the global time selector component, SQL filter, and view options

## Queries

Queries are executed using the `clickhouse.query()` function, typically with filters applied:

```js
const data = await clickhouse.query(
    '/content/path/to/query.sql',
    {
        filters, // Pass global filters (time range, SQL filters),
        params: {
            // SQL query parameters here
        }
    }
);
```

### Query Results should be Tidy Data

We follow the [Tidy Data](https://r4ds.had.co.nz/tidy-data.html) specification,
which states:

- Each variable must have its own column.
- Each observation must have its own row.
- Each value must have its own cell.

Thus, if you have a wide format (with multiple observations per row), you can use ClickHouse
[Array Join](https://clickhouse.com/docs/sql-reference/functions/array-join) to convert it to a
[narrow format](https://en.wikipedia.org/wiki/Wide_and_narrow_data) - this is also called *unpivot* of data.

### Global Filters

The global `filters` object must have the following structure:

```js
const filters = {
    from: "now() - INTERVAL 7 DAY", // a ClickHouse SQL expression evaluating to DateTime which filters the "timestamp" column.
    to: "now()", // a ClickHouse SQL expression evaluating to DateTime which filters the "timestamp" column.
    sqlFilter: "", // an additional WHERE clause part which is applied to all tables
}
```

The global filter is applied in every query where `{filters}` is given as 2nd parameter (QueryOptions).

`filters.from` and `filters.to` work on a column named `timestamp`, so **this name is a requirement for time-based data
**.

Internally, this works by
setting [additional_table_filters](https://clickhouse.com/docs/operations/settings/settings#additional_table_filters).

### Lazy Queries

You can use the `visibility()` helper to defer query execution until a component becomes visible. This improves
performance by only running queries when their results will be displayed:

```js
const data = await visibility().then(() => clickhouse.query(
    '/content/path/to/query.sql',
    {filters, params: {}}
));
```

### SQL Do's and Don'ts

TODO write me

- `timestamp` column name
- Timestamp as ::DateTime64
- enums as ::String (otherwise 1,2,3,4 returned)

(specific examples given for individual chart types)

### SQL Query Parameters

Parameters allow building reusable queries, because the query can contain "holes" which can be filled in during
execution. This is based on
the [ClickHouse Queries with Parameters](https://clickhouse.com/docs/interfaces/http#cli-queries-with-parameters)
feature.

**Example**

```sql
SELECT *
FROM
    events
WHERE
    level = {level:String}
```

```js
await clickhouse.query(
    '/content/path/to/query.sql',
    {
        filters,
        params: {level: 'error'} // <-- fill in parameters here.
    }
);
```

In ClickHouse, the parameters **must be typed**; you specify
the ClickHouse data type after the colon in `{name:type}`. Arbitrary
ClickHouse types are supported, f.e.:

- `{foo:String}`
- `{foo:Nullable(String)}`
- `{foo:DateTime64}`

## Chart Types

Dashica offers multiple pre-configured [Observable Plot](https://observablehq.com/plot/getting-started) chart types to
visualize your data effectively. The key to selecting the right chart depends on understanding your data dimensions (x /
y usually, maybe additionally fill).

### Understanding Data Types

**Categorical/Ordinal Data:**

- Represents distinct, named categories with no inherent numerical value
- Examples: error levels (info, warn, error), server names, product types

**Numeric/Continuous Data:**

- Represents measurements on a continuous scale
- Examples: response times (ms), load times, CPU usage percentages

### Use the following rules to decide which chart type to use:

1. Time is important:
    1. the other dimension represents **aggregated statistical** values like *counts* or *averages*: use `timeBar`
    2. the other dimension represents **numerical buckets**, like *request times between 50-100ms,100-150ms,150-200ms*:
       use `timeHeatmap`
    3. the other dimension represents **categorical buckets**, like *customer A / B / C*: use: `timeHeatmapOrdinal`

2. Comparing categories: Use bar charts (`barVertical, barHorizontal`)

3. Key metrics at a glance: Use `stats`

### Common Chart Options

All charts have the following options:

- `viewOptions`: must match the global `viewOptions` as returned by `const viewOptions = view(component.viewOptions());`
  in the
  chart header.
- `title`: The chart title
- `height`: chart height in px
- all charts use 100% of their available width and are responsive.
- `marginLeft`: margin on the left side of the chart. extend if you need space for wider labels

### barVertical

The barVertical chart displays data as vertical bars, with categories on the x-axis and numeric values on the y-axis.

- Common Chart Options from above
- `x`: categorical/ordinal data [channel](https://observablehq.com/plot/features/marks#marks-have-channels) (required),
  either as:
    - column name
    - anonymous function to compute the value from each row
- `y`: numerical data [channel](https://observablehq.com/plot/features/marks#marks-have-channels) (required), either as:
    - column name
    - anonymous function to compute the value from each row
- `fill`: optional color stacking [channel](https://observablehq.com/plot/features/marks#marks-have-channels) (
  categorical), either as:
    - column name
    - anonymous function to compute the value from each row
- `fx`: optional faceting/grouping [channel](https://observablehq.com/plot/features/marks#marks-have-channels) (
  categorical), either as:
    - column name
    - anonymous function to compute the value from each row
- `fy`: optional faceting/grouping [channel](https://observablehq.com/plot/features/marks#marks-have-channels) (
  categorical), either as:
    - column name
    - anonymous function to compute the value from each row

![Example](docs/images/example-barVertical.png)

**Minimal Example**

```sql
-- app/src/content/__testing/example-git/commits_by_author.sql
{
{file.Read "app/src/content/__testing/example-git/commits_by_author.sql"}
}
```

{{ template "extractSection" "barVertical_commits_by_author" }}

in the page, then use `${commitsByAuthor}` for inserting the chart.

**Example with stacking**

Now, to implement stacking, this works in the same way, except you need to specify the [
`fill` mark option](https://observablehq.com/plot/features/marks#mark-options). You can specify:

- A fixed CSS color string such as: `fill: "purple"`
- A column name in the data to use: `fill: "color_from_data"`
    - If this data contains CSS color strings, they are printed in the given color
    - Otherwise, the `color` scale is used to convert the values to the colors themselves. This can be configured
      further.

```sql
-- app/src/content/__testing/example-git/commits_by_author_and_year.sql
{
{file.Read "app/src/content/__testing/example-git/commits_by_author_and_year.sql"}
}
```

{{ template "extractSection" "barVertical_commits_by_author_and_year" }}

**Example with Faceting/Grouping**

We can use the same raw data from `commits_by_author_and_year.sql` to display the chart with grouping in the X or Y
axis;
this is called faceting:

{{ template "extractSection" "barVertical_commits_by_author_and_year_facetingHorizontal" }}

{{ template "extractSection" "barVertical_commits_by_author_and_year_facetingVertical" }}

### barHorizontal

**This has the same API such as `barVertical`, just with `x` and `y` flipped around: `y` is the categorical/ordinal
scale,
while `x` is the numerical scale.**

The barHorizontal chart displays data as horizontal bars, with categories on the y-axis and numeric values on the
x-axis.

- Common Chart Options from above
- `y`: categorical/ordinal data [channel](https://observablehq.com/plot/features/marks#marks-have-channels) (required),
  either as:
    - column name
    - anonymous function to compute the value from each row
- `x`: numerical data [channel](https://observablehq.com/plot/features/marks#marks-have-channels) (required), either as:
    - column name
    - anonymous function to compute the value from each row
- `fill`: optional color stacking [channel](https://observablehq.com/plot/features/marks#marks-have-channels) (
  categorical), either as:
    - column name
    - anonymous function to compute the value from each row
- `fx`: optional faceting/grouping [channel](https://observablehq.com/plot/features/marks#marks-have-channels) (
  categorical), either as:
    - column name
    - anonymous function to compute the value from each row
- `fy`: optional faceting/grouping [channel](https://observablehq.com/plot/features/marks#marks-have-channels) (
  categorical), either as:
    - column name
    - anonymous function to compute the value from each row

![Example](docs/images/example-barHorizontal.png)

**Minimal Example**

<details><summary>commits_by_author.sql (as shown above already)</summary>

```sql
-- app/src/content/__testing/example-git/commits_by_author.sql
{
{file.Read "app/src/content/__testing/example-git/commits_by_author.sql"}
}
```

</details>

{{ template "extractSection" "barHorizontal_commits_by_author" }}

in the page, then use `${commitsByAuthor}` for inserting the chart.

**Example with stacking**

Now, to implement stacking, this works in the same way, except you need to specify the [
`fill` mark option](https://observablehq.com/plot/features/marks#mark-options). You can specify:

- A fixed CSS color string such as: `fill: "purple"`
- A column name in the data to use: `fill: "color_from_data"`
    - If this data contains CSS color strings, they are printed in the given color
    - Otherwise, the `color` scale is used to convert the values to the colors themselves. This can be configured
      further.

```sql
-- app/src/content/__testing/example-git/commits_by_author_and_year.sql
{
{file.Read "app/src/content/__testing/example-git/commits_by_author_and_year.sql"}
}
```

{{ template "extractSection" "barHorizontal_commits_by_author_and_year" }}

**Example with Faceting/Grouping**

We can use the same raw data from `commits_by_author_and_year.sql` to display the chart with grouping in the X or Y
axis;
this is called faceting:

{{ template "extractSection" "barHorizontal_commits_by_author_and_year_facetingHorizontal" }}

{{ template "extractSection" "barHorizontal_commits_by_author_and_year_facetingVertical" }}

### timeBar

The `timeBar` chart displays data as vertical bars, with time on the x-axis and numeric values on the y-axis.

`timeBar` is a variation of `barVertical`, where the `x` Axis is the time axis. To output time in a ClickHouse query,
you MUST cast the value to `DateTime64` like following, as this is the format Observable Plot can work with natively:

```sql
SELECT
    time ::DateTime64 as timestamp
FROM
    git.commits
```

- Common Chart Options from above
- `x`: time data [channel](https://observablehq.com/plot/features/marks#marks-have-channels) (required), either as:
    - column name
    - anonymous function to compute the value from each row
- `xBucketSize`: how wide should a single bar be rendered, in milliseconds (required).
    - each bar spans the `[x, x+xBucketSize]` interval.
    - f.e. to set it to 15 Minutes, use `xBucketSize: 15*60*1000`
- `y`: numerical data [channel](https://observablehq.com/plot/features/marks#marks-have-channels) (required), either as:
    - column name
    - anonymous function to compute the value from each row
- `fill`: optional color stacking [channel](https://observablehq.com/plot/features/marks#marks-have-channels) (
  categorical), either as:
    - column name
    - anonymous function to compute the value from each row
- `tip`: optional tip configuration, e.g. to render additional result columns in the tip:

   ```js
   tip: {
     channels: {
      // label -> column name
      "Instanz": "instance",
      "Status": "status"
     }
   }
   ```

![Example](docs/images/example-timeBar.png)

**Minimal Example**

```sql
-- app/src/content/__testing/example-git/commits_by_date.sql
{
{file.Read "app/src/content/__testing/example-git/commits_by_date.sql"}
}
```

{{ template "extractSection" "timeBar_commits_by_date" }}

**Example with stacking**

Now, to implement stacking, this works in the same way, except you need to specify the [
`fill` mark option](https://observablehq.com/plot/features/marks#mark-options). You can specify:

- A fixed CSS color string such as: `fill: "purple"`
- A column name in the data to use: `fill: "color_from_data"`
    - If this data contains CSS color strings, they are printed in the given color
    - Otherwise, the `color` scale is used to convert the values to the colors themselves. This can be configured
      further.

```sql
-- app/src/content/__testing/example-git/commits_by_author_and_date.sql
{
{file.Read "app/src/content/__testing/example-git/commits_by_author_and_date.sql"}
}
```

{{ template "extractSection" "timeBar_commits_by_author_and_date" }}

### TODO: timeHeatmap

![Example](docs/images/example-timeHeatmap.png)

**TODO: EXAMPLES HERE**

### TODO: timeHeatmapOrdinal

- `x`: time
- `y`: categorical (f.e. Project A/B/C)
- coloring of each cell via `fill` (numerical, f.e. `count` per x/y combination)

### TODO: stats

- example for SQL query (minimal usage)
- example for chart (minimal usage)

### Table view with search and details

TODO WRITE ME

## Advanced Chart Examples

### pinning colors (ok, warn, error, ...)

### deciding on colors in SQL

### comparison this vs last week

### TODO: custom chart types

decorate...

### Collapsible Sections

## Alerting

The alerting system allows you to:

- Define custom alerts using SQL queries
- Set threshold conditions for triggering alerts
- Configure alert check frequencies
- Customize alert messages

### Alert Configuration

Alerts are defined in YAML files named `alerts.yaml` inside `client/content/` with the following structure:

```yaml
alerts:
  "alertName": # different alert names here
    query_path: ./alerts/my_query.sql
    # optional, if query contains placeholders
    params:
      param1: value1
      param2: value2

    # the condition to alert on
    alert_if:
      value_gt: 1000
    message: ERROR - Alert description

    # the check interval
    check_every: '@15minutes'
```

### Configuration Fields

| Field         | Description                                                      |
|---------------|------------------------------------------------------------------|
| `query_path`  | Path to the SQL query file that generates metrics                |
| `params`      | Parameters to inject into the SQL query                          |
| `alert_if`    | Condition that triggers the alert (e.g., `value_gt`, `value_lt`) |
| `message`     | Message to display when the alert triggers                       |
| `check_every` | Frequency for checking the alert (cron-like expression)          |

### SQL Query Format

Alert queries must follow a specific format:

```sql
--BUCKET: toStartOfFifteenMinutes(--NOW--)
SELECT
    toUnixTimestamp(toStartOfFifteenMinutes(timestamp)) as time,
    count(*)                                            as value
FROM
    your_table
WHERE
    your_conditions
GROUP BY
    time
    --HAVING-- time=--BUCKET--
ORDER BY
    time ASC;
```

### Important Query Elements

1. **BUCKET Definition**: The `--BUCKET:` comment is required and defines the time bucketing for alert evaluation.
   ```
   --BUCKET: toStartOfFifteenMinutes(--NOW--)
   ```

   For Monotonically Increasing Metrics (e.g., counters), you can alert on **the current time bucket**:

    ```
    -- ! use this for counters etc.
    --BUCKET: toStartOfFifteenMinutes(--NOW--)
    ```

    **For Non-Monotonic Metrics (e.g., averages), you have to use the previous complete time bucket,**
    because otherwise an alert might be thrown at the beginning of the interval based on little data, but not
    anymore after more values came in; leading to a false positive:

    ```
    -- ! use this for averages etc.
    --BUCKET: toStartOfFifteenMinutes(--NOW-- - INTERVAL 15 MINUTE)
    ```

2. **Required Columns**:

The result set needs the following 

- `time_ts`: Timestamp for the data point, in Unix timestamp format: Usually: `toUnixTimestamp(toStartOfFifteenMinutes(timestamp)) as time_ts`
- `value`: The metric value to check against alert conditions

3`--HAVING--` marker, referencing the current time bucket; so the system can evaluate the current value only.

4. (Optional) **Parameterization**: Use curly braces to define parameters that can be injected:
   ```
   WHERE event_dataset = {event_dataset:String}
   ```

### Alert Conditions

Currently supported alert conditions:

| Condition  | Description                                                 |
|------------|-------------------------------------------------------------|
| `value_gt` | Triggers when the value exceeds the specified threshold     |
| `value_lt` | Triggers when the value falls below the specified threshold |


### Alert Examples: HTTP Error Alert

```yaml
alerts:
  http500ErrorsOverLimit:
    query_path: ./alerts/http_errors_per_hour.sql
    params:
      customer_tenant: oekokiste
      min_status: 500
      max_status: 599
      skip_status: 0
    alert_if:
      value_gt: 500
    message: ERROR - too many failures
    check_every: '@5minutes'
```

The corresponding SQL query:

```sql
--BUCKET: toStartOfHour(--NOW--)
SELECT
    toStartOfHour(timestamp)::DateTime64 as time, toUnixTimestamp(time) as time_ts,
    count(*) as value
FROM
    mv_caddy_accesslog
WHERE
      mv_caddy_accesslog.customer_tenant = {customer_tenant:String}
  AND mv_caddy_accesslog.status >= {min_status:Int}
  AND mv_caddy_accesslog.status <= {max_status:Int}
  AND mv_caddy_accesslog.status != {skip_status:Int}
GROUP BY
    time
ORDER BY
    time ASC
```

### Development vs. Production

- **Production**: Alerts are evaluated incrementally as scheduled by `check_every`.
- **Development**: The `BatchEvaluator` can evaluate alerts for multiple time points at once, useful for testing and
  retrospective analysis. This can be triggered by pressing the `Calculate alerts for current time range` Button
  on the alerts screen.

### Creating a New Alert

1. Run the system locally by running `dev setup; dev up`
2. **Create a SQL query file** following the format above
3. **Add an alert definition** to your alerts YAML file
4. **Test your alert** using the BatchEvaluator in development, by opening an `Alerts` screen, and pressing batch evaluation
5. **Deploy** to production

## Best Practices

1. **Choose appropriate bucketing**: Match your `--BUCKET` definition to your `check_every` interval
2. **Set reasonable thresholds**: Start with conservative thresholds and adjust based on observed patterns
3. **Use parameters**: Parameterize queries to make them reusable across different contexts
4. **Include context in messages**: Make alert messages descriptive enough to understand the issue


-----------
-----------
-----------

# Production Setup

- [ ] ==(where (IP) is the prod server)==
- [ ] ==(How is the prod server set up, e.g. via Ansible)==
- [ ] ==(how does application deployment work)==
- [ ] ==(what manual steps are necessary)==
- [ ] ==(how are backups done)==
- [ ] ==(how to access the prod server via SSH)==
- [ ] ==(how to access the prod DB via SSH)==
- [ ] ==(how does logging/monitoring work)==
- [ ] ==(how can you run data imports)==

-----------
-----------
-----------

# Architecture

see ./docs

# Thanks to

**ESBuild** - we copied their go/node.js binary build setup + distribution through NPM and adjusted that.