# Writing SQL Queries

```js
import {chart, clickhouse, component} from '/dashica/index.js';

const filters = view(component.globalFilter());
```

## clickhouse.query()

The `clickhouse.query()` function is used to execute SQL queries against the Clickhouse database.

```js echo
clickhouse.query(
    '/src/docs/02_first_dashboard/requests_per_day.sql',
    {filters, params: {}}
)
```

It returns the data in the highly efficient Apache Arrow format, which is a binary transmission format
and a columnar data format - so very well suited to big analytics data. That's why you cannot see the result
as array. You can, however, use the `.toArray()` function on the result set to convert it to an array:

```js echo
const result = await clickhouse.query(
    '/src/docs/02_first_dashboard/requests_per_day.sql',
    {filters, params: {}}
);
display(result.toArray());
```

<div class="warning">

If you use `.toArray()`, you'll lose the efficiency of the columnar format, as you are again converting
to a regular array (row based). Observable Plot can directly work with the columnar format, so only use
`.toArray()` for debugging or custom scenarios.

</div>

The query result is passed as the first parameter to `chart.barVertical()`. Generally, all charts
receive their data as the first parameter, and an `Options` object as the second parameter.


## Query Results should be Tidy Data

We follow the [Tidy Data](https://r4ds.had.co.nz/tidy-data.html) specification,
which states:

- Each variable must have its own column.
- Each observation must have its own row.
- Each value must have its own cell.

Thus, if you have a wide format (with multiple observations per row), you can use ClickHouse
[Array Join](https://clickhouse.com/docs/sql-reference/functions/array-join) to convert it to a
[narrow format](https://en.wikipedia.org/wiki/Wide_and_narrow_data) - this is also called *unpivot* of data.

## Global Filters

The global `filters` object has the following structure:

```js
filters
```


The global filter is applied in every query where `{filters}` is given as 2nd parameter (QueryOptions).

`filters.from` and `filters.to` work on a column named `timestamp`, so **this name is a requirement for time-based data**.

Internally, this works by
setting [additional_table_filters](https://clickhouse.com/docs/operations/settings/settings#additional_table_filters).

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

