```js
import hljs from 'npm:highlight.js';
import {chart, clickhouse, component} from '/dashica/index.js';

const filters = view(component.globalFilter());
const viewOptions = view(component.viewOptions());
```

# stats

The stats chart displays key numeric metrics as labeled statistics cards, ideal for showing summary values and KPIs.

The `stats` chart is ideal for:
- Displaying key performance indicators (KPIs)
- Showing summary statistics (totals, counts, percentages)
- Highlighting important metrics with color coding
- Creating dashboard overview sections

## Data Requirements

**When to use?** Use stats when you want to display one or more numeric values with labels in a compact, easy-to-read format.

Your SQL query should return the following column types:

- **label** (or use `title` prop): Text/String describing the statistic
- **value**: Numeric (Integer/Float) - the actual metric value
- **color** (optional): Text/String - CSS color for the value text (e.g., "forestgreen", "#FF0000", "crimson")

## Minimal Example: Single Stat with `title`

When displaying a single statistic, you can use the `title` prop instead of a `label` column.

```js
const n = document.createElement('pre');
n.innerHTML = hljs.highlight(await FileAttachment("10_queries/request_stats.sql").text(), {language: 'sql'}).value;
display(n);
```

```js echo
display(chart.stats(
    await clickhouse.query(
        '/src/docs/10_queries/request_stats.sql',
        {filters}
    ), {
        viewOptions,
        
        // Optional:
        title: 'Total Requests',
    }
));
```

## Multiple Stats with `label`

When your SQL query returns multiple rows, each row becomes a separate stat card. The `label` column provides the label for each stat.

```js
const n = document.createElement('pre');
n.innerHTML = hljs.highlight(await FileAttachment("10_queries/request_stats_by_status.sql").text(), {language: 'sql'}).value;
display(n);
```

```js echo
display(chart.stats(
    await clickhouse.query(
        '/src/docs/10_queries/request_stats_by_status.sql',
        {filters}
    ), {
        viewOptions,
    }
));
```

## Adding Colors with `color` column

You can add color coding to your stats by including a `color` column in your SQL query. The color should be a valid CSS color string.

```js
const n = document.createElement('pre');
n.innerHTML = hljs.highlight(await FileAttachment("10_queries/request_stats_with_color.sql").text(), {language: 'sql'}).value;
display(n);
```

```js echo
display(chart.stats(
    await clickhouse.query(
        '/src/docs/10_queries/request_stats_with_color.sql',
        {filters}
    ), {
        viewOptions,
    }
));
```

## Using `fill` prop for default color

You can set a default color for all stats using the `fill` prop. This color will be used unless a specific color is provided in the data.

```js echo
display(chart.stats(
    await clickhouse.query(
        '/src/docs/10_queries/request_stats_by_status.sql',
        {filters}
    ), {
        viewOptions,
        fill: 'pink', // Default color for all stats
    }
));
```

## Reference for `stats`

**Data Columns in the SQL result**

- `label`: Text/String - the label for each statistic (required unless `title` prop is used)
- `value`: Numeric - the numeric value to display (required)
- `color`: Text/String - optional CSS color for the value (optional)

**Specific Options**

- `title`: String - used as the label when displaying a single stat without a `label` column (optional)
- `fill`: String - default CSS color to use for values when no `color` column is provided (optional)

**Common Chart Options**

- `viewOptions`: must match the global `viewOptions` as returned by `const viewOptions = view(component.viewOptions());` in the chart header.

## Tips for Using Stats

1. **Keep it focused**: Stats work best for displaying 3-7 key metrics. Too many stats can overwhelm the dashboard.

2. **Use color meaningfully**: Use green for positive/successful metrics, red for errors/problems, and orange for warnings.

3. **Rounding values**: The stats component automatically rounds values to 2 decimal places. For more control, round in your SQL query.

4. **Combine with other charts**: Stats are often used at the top of a dashboard to provide quick overview metrics, with detailed charts below.
