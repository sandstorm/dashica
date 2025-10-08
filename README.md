# Dashicy


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

# User Manual

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



# Thanks to

**ESBuild** - we copied their go/node.js binary build setup + distribution through NPM and adjusted that.