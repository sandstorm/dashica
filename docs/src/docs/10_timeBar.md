```js
import hljs from 'npm:highlight.js';
import {chart, clickhouse, component} from '/dashica/index.js';

const filters = view(component.globalFilter());
const viewOptions = view(component.viewOptions());
```

# timeBar

The timeBar chart displays time-series data as bars, with time on the x-axis and numeric values on the y-axis.

The `timeBar` chart is ideal for:
- Visualizing time-series data (e.g. requests over time, logs per minute)
- Displaying aggregated values over time buckets
- Stacking data by additional dimensions with color
- Monitoring and observability dashboards

## Data Requirements

**When to use?** Use timeBar when your data has temporal x-values (timestamps) and numeric y-values.

Your SQL query should return the following column types:

- **x-axis**: DateTime/Timestamp (temporal data)
- **y-axis**: Numeric (Integer/Float for counts, sums, averages)
- **fill** (optional): Text/String for stacking categories

## Automatic Bucketing

timeBar supports automatic time bucketing, where Dashica adjusts the granularity based on the selected time range. Add a `-- BUCKET:` comment to your SQL query:

```js
const n = document.createElement('pre');
n.innerHTML = hljs.highlight(await FileAttachment("03_queries/complete_example.sql").text(), {language: 'sql'}).value;
display(n);
```

The `-- BUCKET:` comment must contain the *exact SQL expression* used in the `SELECT` clause. Dashica will automatically replace it with an appropriate granularity (1 second, 1 minute, 5 minutes, 15 minutes, 1 hour, 1 day, 1 week) based on your time range.

When auto-bucketing is active, the y-axis values are normalized to "per second" (e.g., "requests / s") for easier comparison across different bucket sizes.

## Minimal Example with Auto-Bucketing

- the `x` channel is the *TIMESTAMP* axis, as a field (column) name from the SQL result
- the `y` channel is the *VALUE* axis, as a field (column) name from the SQL result

```js echo
display(chart.timeBar(
    await clickhouse.query(
        '/src/docs/03_queries/complete_example.sql',
        {filters}
    ), {
        viewOptions, invalidation,
        x: 'timestamp',
        y: 'request_count',
        
        // Optional:
        title: 'Requests over time',
        height: 150,
        marginLeft: 60,
    }
));
```

## Manual xBucketSize

If you don't use auto-bucketing with `-- BUCKET:`, you must specify the `xBucketSize` parameter in milliseconds:

```js echo
display(chart.timeBar(
    await clickhouse.query(
        '/src/docs/03_queries/complete_example.sql',
        {filters}
    ), {
        viewOptions, invalidation,
        x: 'timestamp',
        y: 'request_count',
        xBucketSize: 15*60*1000, // 15 minutes in milliseconds
        
        title: 'Requests over time (manual bucket size)',
        height: 150,
        marginLeft: 60,
    }
));
```

Common bucket sizes:
- 1 second: `1000`
- 1 minute: `60*1000`
- 5 minutes: `5*60*1000`
- 15 minutes: `15*60*1000`
- 1 hour: `60*60*1000`
- 1 day: `24*60*60*1000`

## Stacking with color using `fill`

With the `fill` channel, you can stack data by additional dimensions and visualize them with colors:

```js echo
const fixedColorsForErrorLevels = {
    legend: true,
    domain: ['2xx', '3xx', '4xx', '5xx', '0xx', 'other'],
    range: ['#56AF18', '#F4C83E', '#F77C39', '#D73027', '#CCCCCC', '#8E44AD'],
    unknown: '#8E44AD',
};

display(chart.timeBar(
    await clickhouse.query(
        '/src/docs/03_queries/complete_example.sql',
        {filters}
    ), {
        viewOptions, invalidation,
        x: 'timestamp',
        y: 'request_count',
        fill: 'statusGroup', // Stack by status group
        color: fixedColorsForErrorLevels,
        
        title: 'Requests by status over time',
        height: 150,
        marginLeft: 60,
    }
));
```

## Disabling the `color` legend

To disable the color legend, set the `color` option to `{ legend: false }`:

```js echo
display(chart.timeBar(
    await clickhouse.query(
        '/src/docs/03_queries/complete_example.sql',
        {filters}
    ), {
        viewOptions, invalidation,
        x: 'timestamp',
        y: 'request_count',
        fill: 'statusGroup',
        color: { legend: false }, // Hide legend
        
        title: 'Requests by status over time (no legend)',
        height: 150,
        marginLeft: 60,
    }
));
```

## Using specific colors

The `color` option supports detailed configuration:

- `legend` (boolean): whether to show the legend
- `domain` (array): the domain of the color scale (e.g. `["2xx", "3xx", "4xx"]`)
- `range` (array): the range of the color scale (e.g. `["#56AF18", "#F4C83E", "#F77C39"]`)
- `unknown` (string): the color to use for unknown values (e.g. `'grey'`)

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

display(chart.timeBar(
    await clickhouse.query(
        '/src/docs/03_queries/complete_example.sql',
        {filters}
    ), {
        viewOptions, invalidation,
        x: 'timestamp',
        y: 'request_count',
        fill: 'statusGroup',
        // Fixed colors ensure green is always "good" and red is always "bad"
        color: fixedColorsForErrorLevels,
        
        title: 'Requests with fixed colors',
        height: 150,
        marginLeft: 60,
    }
));
```

## Calculating with colors in the SQL query

If the column specified by `fill` contains CSS color strings, they are rendered verbatim in the given color:

```js echo
display(chart.timeBar(
    await clickhouse.query(
        '/src/docs/10_queries/requests_by_status_and_host_name_colorized.sql',
        {filters}
    ), {
        viewOptions, invalidation,
        x: 'timestamp',
        y: 'request_count',
        fill: 'statusGroupColor', // Column containing CSS color values
        
        title: 'Requests with SQL-calculated colors',
        height: 150,
        marginLeft: 60,
    }
));
```

## Customizing tooltips with `tip`

The `tip` option controls tooltips that appear on hover. By default, tooltips are enabled and show all data channels.

You can customize tooltips using the `tip` option with a `channels` object to specify which fields to display:

```js echo
display(chart.timeBar(
    await clickhouse.query(
        '/src/docs/03_queries/complete_example.sql',
        {filters}
    ), {
        viewOptions, invalidation,
        x: 'timestamp',
        y: 'request_count',
        fill: 'statusGroup',
        
        tip: {
            channels: {
                "Status": "statusGroup",
                "Count": "request_count"
            }
        },
        
        title: 'Requests with custom tooltip',
        height: 150,
        marginLeft: 60,
    }
));
```

To disable tooltips entirely, set `tip: false`.

## Faceting using `fx` and `fy`

Faceting allows you to split your chart into multiple subplots based on a categorical dimension:

```js echo
display(chart.timeBar(
    await clickhouse.query(
        '/src/docs/03_queries/complete_example.sql',
        {filters}
    ), {
        viewOptions, invalidation,
        x: 'timestamp',
        y: 'request_count',
        fx: 'statusGroup', // Facet horizontally by status
        
        title: 'Requests faceted by status (horizontal)',
        height: 150,
        marginLeft: 60,
    }
));
```

```js echo
display(chart.timeBar(
    await clickhouse.query(
        '/src/docs/03_queries/complete_example.sql',
        {filters}
    ), {
        viewOptions, invalidation,
        x: 'timestamp',
        y: 'request_count',
        fy: 'statusGroup', // Facet vertically by status
        
        title: 'Requests faceted by status (vertical)',
        height: 300,
        marginLeft: 60,
        marginBottom: 70,
    }
));
```

## Adding extra marks with `extraMarks`

The `extraMarks` option allows you to add additional [Observable Plot marks](https://observablehq.com/plot/features/marks) to your chart. This is useful for adding reference lines, annotations, or other visual elements that complement your data.

`extraMarks` accepts an array of Plot mark objects. Common use cases include:

- **Threshold lines**: Use `Plot.ruleY()` to add horizontal reference lines for thresholds, targets, or limits
- **Trend lines**: Use `Plot.lineY()` to add trend or comparison lines
- **Annotations**: Use `Plot.text()` to add labels or annotations
- **Additional data series**: Add any other Plot marks like dots, areas, or custom shapes

### Example: Adding threshold lines

This example shows how to add horizontal threshold lines to indicate acceptable ranges or alert levels:

```js echo
const thresholdValue = 1000;

display(chart.timeBar(
    await clickhouse.query(
        '/src/docs/03_queries/complete_example.sql',
        {filters}
    ), {
        viewOptions, invalidation,
        x: 'timestamp',
        y: 'request_count',
        
        // Add a red threshold line
        extraMarks: [
            Plot.ruleY([thresholdValue], {stroke: "red", strokeWidth: 2, strokeDasharray: "5,5"}),
            Plot.text([thresholdValue], {
                x: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7), // 7 days ago
                y: thresholdValue,
                text: [`Threshold: ${thresholdValue}`],
                textAnchor: "start",
                dy: -8,
                fill: "red"
            })
        ],
        
        title: 'Requests with threshold line',
        height: 150,
        marginLeft: 60,
    }
));
```

### Example: Conditional threshold marks

You can conditionally add marks based on data properties. This example is from the alerting system:

```
// Example from alerting system
extraMarks: [
    data.dashicaAlertIf?.value_gt ?
        Plot.ruleY([data.dashicaAlertIf.value_gt], {stroke: "red"})
        : undefined,
    data.dashicaAlertIf?.value_lt ?
        Plot.ruleY([data.dashicaAlertIf.value_lt], {stroke: "red"})
        : undefined
]
```

### Available Plot marks

You can use any mark from [Observable Plot](https://observablehq.com/plot/features/marks), including:

- `Plot.ruleY()` / `Plot.ruleX()` - horizontal/vertical reference lines
- `Plot.lineY()` / `Plot.lineX()` - line charts
- `Plot.dot()` - scatter points
- `Plot.text()` - text annotations
- `Plot.areaY()` - area charts
- `Plot.arrow()` - arrows for annotations

For complete documentation on available marks and their options, see the [Observable Plot marks documentation](https://observablehq.com/plot/features/marks).

## Reference for `timeBar`

**Specific options**

- `x`: temporal data channel - i.e. column name containing timestamps (required)
- `y`: numerical data channel - i.e. column name to use for the y axis (required)
- `xBucketSize`: time bucket size in milliseconds (required unless using auto-bucketing with `-- BUCKET:`)
- `fill`: optional color stacking channel (categorical)
- `fx`: optional faceting/grouping channel for the X Axis
- `fy`: optional faceting/grouping channel for the Y Axis
- `tip`: tooltip configuration (boolean, or object with `channels` for custom fields)
- `extraMarks`: array of additional Plot marks to render

**Common Chart Options**

- `viewOptions`: must match the global `viewOptions` as returned by `const viewOptions = view(component.viewOptions());` in the chart header. Supports logarithmic scale with `"VIEW_LOGARITHMIC"`.
- `invalidation`: Observable invalidation promise for proper cleanup
- `title`: The chart title
- `height`: chart height in px
- all charts use 100% of their available width and are responsive
- `marginLeft`: margin on the left side of the chart. extend if you need space for wider labels
- `marginTop`: margin on the top side of the chart. extend if you need space for wider labels
- `marginRight`: margin on the right side of the chart. extend if you need space for wider labels
- `marginBottom`: margin on the bottom side of the chart. extend if you need space for wider labels
- `color`: color scale options (legend, domain, range, unknown)
