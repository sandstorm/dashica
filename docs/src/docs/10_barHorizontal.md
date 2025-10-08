```js
import hljs from 'npm:highlight.js';
import {chart, clickhouse, component} from '/dashica/index.js';

const filters = view(component.globalFilter());
const viewOptions = view(component.viewOptions());
```

# barHorizontal

The barHorizontal chart displays data as horizontal bars, with numeric values on the x-axis and categories on the y-axis.

The `barHorizontal` chart is ideal for:
- Comparing categories (e.g. commits per year)
- Displaying aggregated values
- Stacking data by additional dimensions

## Data Requirements

**When to use?** Use barHorizontal when your data has numeric x-values and categorical y-values.

Your SQL query should return the following column types:

- **x-axis**: Numeric (Integer/Float for counts, sums, averages)
- **y-axis**: Text/String (categorical data like "2020", "2021", "admin", "user")
- **fill** (optional): Text/String for stacking categories

## Minimal Example: `x` and `y`

- the `x` channel is the *VALUE* axis, as a field (column) name from the SQL result
- the `y` channel is the *GROUPING/Category* axis, as a field (column) name from the SQL result

```js
const n = document.createElement('pre');
n.innerHTML = hljs.highlight(await FileAttachment("10_queries/requests_by_status.sql").text(), {language: 'sql'}).value;
display(n);
```

```js echo
display(chart.barHorizontal(
    await clickhouse.query(
        '/src/docs/10_queries/requests_by_status.sql',
        {filters}
    ), {
        viewOptions, invalidation,
        x: 'requests',
        y: 'statusGroup',
        
        // Optional::
        title: 'Requests by status',
        height: 150,
        marginLeft: 100,
    }
));
```


## Stacking with color using `fill`

with the `fill` channel, you can stack data by additional dimensions.

```js
const n = document.createElement('pre');
n.innerHTML = hljs.highlight(await FileAttachment("10_queries/requests_by_status_and_host_name.sql").text(), {language: 'sql'}).value;
display(n);
```


```js echo
display(chart.barHorizontal(
    await clickhouse.query(
        '/src/docs/10_queries/requests_by_status_and_host_name.sql',
        {filters}
    ), {
        viewOptions, invalidation, // Pass through global view options & Invalidation promise
        x: 'requests',
        y: 'statusGroup',
        
        fill: 'host_name', // NEW
        
        // Optional properties:
        title: 'Requests by status / host name',
        height: 150,
        marginLeft: 100, // more space for the y axis labels on the left
    }
));
```

## Disabling the `color` legend

To disable the color legend, you can set the `color` option to `{ legend: false }`:

```js echo
display(chart.barHorizontal(
    await clickhouse.query(
        '/src/docs/10_queries/requests_by_status_and_host_name.sql',
        {filters}
    ), {
        viewOptions, invalidation, // Pass through global view options & Invalidation promise
        x: 'requests',
        y: 'statusGroup',
        
        fill: 'host_name',
        color: { legend: false }, // NEW
        
        // Optional properties:
        title: 'Requests by status / host name',
        height: 150,
        marginLeft: 60, // more space for the y axis labels on the left
    }
));
```

### Alternative example

<details>
<summary>Click to see SQL query</summary>

```js
const n = document.createElement('pre');
n.innerHTML = hljs.highlight(await FileAttachment("02_first_dashboard/git_commits_by_year_and_author.sql").text(), {language: 'sql'}).value;
display(n);
```

</details>

```js echo
display(chart.barHorizontal(
    await clickhouse.query(
        '/src/docs/02_first_dashboard/git_commits_by_year_and_author.sql',
        {filters}
    ), {
        viewOptions, invalidation, // Pass through global view options & Invalidation promise
        x: 'commitCount',
        y: 'year',
        fill: 'author',
        color: { legend: false }, // hide the legend, as it is too big otherwise

        height: 250,
        marginLeft: 50
    }
));
```

## Using specific colors

The `color` option has the following options:

- `legend` (boolean): whether to show the legend
- `domain` (array): the domain of the color scale (e.g. `["red", "green", "blue"]`)
- `range` (array): the range of the color scale (e.g. `["#FF0000", "#00FF00", "#0000FF"]`)
- `unknown` (string): the color to use for unknown values (e.g. `grey`)

The 1st entry in `domain` is rendered using the 1st color in `range`, and so on.
For every value not in `domain`, the `unknown` color is used.

The `domain` ordering is also used for ordering the entries in the legend.

```js echo
const fixedColorsForErrorLevels = {
    legend: true,
    domain: ['2xx', '3xx', '4xx', '5xx', '0xx', 'other'],
    range: ['#56AF18', '#F4C83E', '#F77C39', '#D73027', '#CCCCCC', '#8E44AD'],
    unknown: '#8E44AD',
};

display(chart.barHorizontal(
    await clickhouse.query(
        '/src/docs/02_first_dashboard/requests_per_day_and_statusGroup.sql',
        {filters}
    ), {
        viewOptions, invalidation, // Pass through global view options & Invalidation promise
        x: 'requests',
        y: 'day',
        fill: 'statusGroup',
        // we want to use fixed colors, so that green is always "good" and red is always "bad"
        color: fixedColorsForErrorLevels,
        
        marginLeft: 80,
        height: 150
    }
));
```

## Calculating with colors in the SQL query

If the column specified by `fill` contains CSS color strings, they are printed verbatim in the given color. Example:

```js
const n = document.createElement('pre');
n.innerHTML = hljs.highlight(await FileAttachment("10_queries/requests_by_status_and_host_name_colorized.sql").text(), {language: 'sql'}).value;
display(n);
```

```js echo
display(chart.barHorizontal(
    await clickhouse.query(
        '/src/docs/10_queries/requests_by_status_and_host_name_colorized.sql',
        {filters}
    ), {
        viewOptions, invalidation, // Pass through global view options & Invalidation promise
        x: 'requests',
        y: 'statusGroup',
        fill: 'statusGroupColor', // use the color calculated in the SQL query
        
        marginBottom: 70,
        marginLeft: 50,
        height: 150
    }
));
```

## Faceting using `fx` and `fy`

We can use the same raw data from `commits_by_author_and_year.sql` to display the chart with grouping in the X or Y axis this is called faceting:

```js echo
display(chart.barHorizontal(
    await clickhouse.query(
        '/src/docs/02_first_dashboard/git_commits_by_year_and_author.sql',
        {filters}
    ), {
        viewOptions, invalidation, // Pass through global view options & Invalidation promise
        title: 'With faceting - commits by user, grouped by year (horizontally).',
        x: 'commitCount',
        y: 'author',
        fx: 'year',
        height: 250,
        color: { legend: false }, // hide the legend, as it is too big otherwise
        marginLeft: 150,
    }
));
```

```js echo
display(chart.barHorizontal(
    await clickhouse.query(
        '/src/docs/02_first_dashboard/git_commits_by_year_and_author.sql',
        {filters}
    ), {
        viewOptions, invalidation, // Pass through global view options & Invalidation promise
        title: 'With faceting - commits by user, grouped by year (vertically).',
        x: 'commitCount',
        y: 'author',
        fy: 'year',
        
        height: 850,
        marginBottom: 100,
        marginLeft: 70,
    }
));
```

## Reference for `barHorizontal`

**Specific options**

- `x`: numerical data channel - i.e. column name to use for the x axis (required)
- `y`: categorical/ordinal data channel - i.e. column name to use for the y axis (required)
- `fill`: optional color stacking channel (categorical)
- `fx`: optional faceting/grouping channel for the X Axis
- `fy`: optional faceting/grouping channel for the Y Axis

**Common Chart Options**

- `viewOptions`: must match the global `viewOptions` as returned by `const viewOptions = view(component.viewOptions());` in the chart header.
- `title`: The chart title
- `height`: chart height in px
- all charts use 100% of their available width and are responsive.
- `marginLeft`: margin on the left side of the chart. extend if you need space for wider labels
- `marginTop`: margin on the top side of the chart. extend if you need space for wider labels
- `marginRight`: margin on the right side of the chart. extend if you need space for wider labels
- `marginBottom`: margin on the bottom side of the chart. extend if you need space for wider labels
- `color`: color scale options
