```js
import hljs from 'npm:highlight.js';
import {chart, clickhouse, component} from '/dashica/index.js';

const filters = view(component.globalFilter());
const viewOptions = view(component.viewOptions());
```

# Chart Types

Dashica offers multiple pre-configured [Observable Plot](https://observablehq.com/plot/getting-started) chart types to
visualize your data effectively. The key to selecting the right chart depends on understanding your data dimensions.

# Understanding Data Types

**Categorical/Ordinal Data:**

- Represents distinct, named categories with no inherent numerical value
- Examples: error levels (info, warn, error), server names, product types

**Numeric/Continuous Data:**

- Represents measurements on a continuous scale
- Examples: response times (ms), load times, CPU usage percentages

## Use the following rules to decide which chart type to use:

1. Time is important:
    1. the other dimension represents **aggregated statistical** values like *counts* or *averages*: use `timeBar`
    2. the other dimension represents **numerical buckets**, like *request times between 50-100ms,100-150ms,150-200ms*:
       use `timeHeatmap`
    3. the other dimension represents **categorical buckets**, like *customer A / B / C*: use: `timeHeatmapOrdinal`

2. Comparing categories: Use bar charts (`barVertical, barHorizontal`)

3. Key metrics at a glance: Use `stats`

**This is visualized again in the following diagram:**

```mermaid
graph TD;
direction TB;
    start["<b>start here</b>"];
    start-->|Time is important| time;
    time-->|+ <b>aggregated statistical values</b> like counts or averages| timeBar;
    time-->|+ <b>numerical buckets</b>| timeHeatmap;
    time-->|+ <b>categorical buckets</b>| timeHeatmapOrdinal;
    
    start-->|Comparing categories| barCharts;
    barCharts["Bar Charts"]-->barVertical;
    barCharts-->barHorizontal;
    start-->|Numeric Key metrics at a glance| stats;
    start-->|Tabular Values| autoTable;
    
    classDef startNode fill:#ff6b6b,stroke:#c92a2a,stroke-width:3px,color:#fff,font-size:16px;
    class start startNode;
```


# Common Chart Options

All charts have the following options:

- `viewOptions`: must match the global `viewOptions` as returned by `const viewOptions = view(component.viewOptions());`
  in the chart header.
- The `invalidation` promise is [from observable framework](https://observablehq.com/framework/reactivity#invalidation), and is a mechanism to know when the current cell needs to re-render.

- `title`: The chart title
- `height`: chart height in px
- all charts use 100% of their available width and are responsive.
- `marginLeft`: margin on the left side of the chart. extend if you need space for wider labels
- `marginTop`: margin on the top side of the chart. extend if you need space for wider labels
- `marginRight`: margin on the right side of the chart. extend if you need space for wider labels
- `marginBottom`: margin on the bottom side of the chart. extend if you need space for wider labels

# Channels

The SQL result is passed to every chart as data - and in the chart options, you need to specify which columns to use for which "axis".

Axes like `x`, `y`, `fill`, or `fx`/`fy` (for faceting) are called [channels](https://observablehq.com/plot/features/marks#marks-have-channels).

Let's start with an example:

```js echo
display(chart.barVertical(
    await clickhouse.query(
        '/src/docs/10_queries/requests_by_status.sql',
        {filters}
    ), {
        viewOptions, invalidation,
        x: 'statusGroup', // <-- channel
        y: 'requests', // <-- channel
        
        height: 100,
    }
));
```

In the example above, `x` and `y` are channels. They are used to specify which columns to use for the x- and y-axis.

You can specify a channel in the following ways:

- a field (column) name, **in 90% of all cases, you'll need this**
- an accessor function, or
- an array of values of the same length and order as the data.

Instead of using accessor functions etc, we recommend to do the calculation in
the SQL query itself.