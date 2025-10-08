```js
import hljs from 'npm:highlight.js';
```
# Your First Dashboard

Your dashboards are all written in Markdown, with reactive JavaScript sprinkled throughout, and are placed in the `src/` folder.

To get started, create a new file in the `src/` folder, and add the following code:

    ```js
    import {chart, clickhouse, component} from '/dashica/index.js';

    // Global filter (SQL + time range), rendered at the top
    const filters = view(component.globalFilter());

    // Global view options (logarithmic scale)
    const viewOptions = view(component.viewOptions());
    ```

    # Hello World
    
    This is my first Dashica dashboard. Not very exciting yet, but it's a start :)

- The 1st line imports the dashica library, which we will use later to create charts and other components.
- The other lines line renders the global filter, which will be used to filter the data displayed in the charts:
  It is shown at the top of the page. It consists of a SQL input field, on the left, and a time-selector, on the right.
- The `view` function renders interactive elements; and the result of the `view` function is the current result of the view (e.g. the selected view options in this case).

```js
import {chart, clickhouse, component} from '/dashica/index.js';

const filters = view(component.globalFilter());
```

## Example Data

Dashica works with *any* table from Clickhouse, but the examples use snapshots from real-world data. We hope
this makes the examples more useful and approachable.

At some point in the future, we'll explain our full monitoring stack; but for now, we want to showcase the example data.

The table `mv_caddy_accesslog` contains excerpts from Web Server (Caddy) access logs. It has the following relevant structure:

- `timestamp`: The UNIX timestamp with Microsecond precision.
- `request__method` (GET/POST/...)
- `status` (200, 404, ...)

<details>
<summary>Click to show full table structure</summary>
<pre>${clickhouse.showTableStructure('mv_caddy_accesslog')}</pre>
</details>


## Place your first SQL file

Create a .sql file in `src/` - we usually create a subfolder for each dashboard, and place the SQL file there;
but you are free to use any structure you like.

```js
const n = document.createElement('pre');
n.innerHTML = hljs.highlight(await FileAttachment("02_first_dashboard/requests_per_day.sql").text(), {language: 'sql'}).value;
display(n);
```

## Render this SQL file as a Bar Chart

Then, we can render this SQL as a Bar Chart with the following snippet: 

```js echo
display(chart.barVertical(
    await clickhouse.query(
        '/src/docs/02_first_dashboard/requests_per_day.sql',
        {filters}
    ), {
        viewOptions, invalidation, // Pass through global view options & Invalidation promise
        x: 'day',
        y: 'requests',
        
        marginBottom: 70,
        marginLeft: 50,
        height: 250
    }
));
```

This chart is automatically connected to use the global filter (by passing `{filters}` to `clickhouse.query()`); so select a bigger timespan and you'll see the chart update.

Additionally, if you toggle the view options below, the chart will update accordingly because the `viewOptions` are passed as the second parameter to `chart.barVertical()`.


```js echo
const viewOptions = view(component.viewOptions());
```


`invalidation` is provided by Observable to signal when a cell is re-run (e.g., navigation, filter changes). Passing it lets the chart clean up event listeners and re-render safely.

## Grouping by status code

Now, the bar chart is not very exciting, so let's also group by status code:

```js
const n = document.createElement('pre');
n.innerHTML = hljs.highlight(await FileAttachment("02_first_dashboard/requests_per_day_and_statusGroup.sql").text(), {language: 'sql'}).value;
display(n);
```

```js echo
const fixedColorsForErrorLevels = {
    legend: true,
    domain: ['2xx', '3xx', '4xx', '5xx', '0xx', 'other'],
    range: ['#56AF18', '#F4C83E', '#F77C39', '#D73027', '#CCCCCC', '#8E44AD'],
    unknown: '#8E44AD',
};

display(chart.barVertical(
    await clickhouse.query(
        '/src/docs/02_first_dashboard/requests_per_day_and_statusGroup.sql',
        {filters}
    ), {
        viewOptions, invalidation, // Pass through global view options & Invalidation promise
        x: 'day',
        y: 'requests',
        fill: 'statusGroup',
        // we want to use fixed colors, so that green is always "good" and red is always "bad"
        color: fixedColorsForErrorLevels,
        
        marginBottom: 70,
        marginLeft: 50,
        height: 250
    }
));
```

## Vertical Faceting with `fy`

We can also play around with other display options, like vertical and horizontal faceting.

Vertical facets with `fy` split the chart into one row per category.

```js echo
display(chart.barVertical(
    await clickhouse.query(
        '/src/docs/02_first_dashboard/requests_per_day_and_statusGroup.sql',
        {filters}
    ), {
        viewOptions, invalidation, // Pass through global view options & Invalidation promise
        x: 'day',
        y: 'requests',
        fill: 'statusGroup',
        fy: 'statusGroup',
        // we want to use fixed colors, so that green is always "good" and red is always "bad"
        color: fixedColorsForErrorLevels,

        marginBottom: 70,
        marginLeft: 50,
        height: 250
    }
));
```

## Horizontal Faceting with `fx`

Horizontal facets with `fx` split the chart into one column per category. Horizontal and vertical facets can be combined, like in the following example:

```js
const n = document.createElement('pre');
n.innerHTML = hljs.highlight(await FileAttachment("02_first_dashboard/requests_per_day_and_statusGroup_and_method.sql").text(), {language: 'sql'}).value;
display(n);
```

```js echo
display(chart.barVertical(
    await clickhouse.query(
        '/src/docs/02_first_dashboard/requests_per_day_and_statusGroup_and_method.sql',
        {filters}
    ), {
        viewOptions, invalidation, // Pass through global view options & Invalidation promise
        x: 'statusGroup',
        y: 'requests',
        fill: 'statusGroup',
        fx: 'day',
        fy: 'request__method',
        // we want to use fixed colors, so that green is always "good" and red is always "bad"
        color: fixedColorsForErrorLevels,
        
        marginBottom: 70,
        marginLeft: 50,
        height: 250
    }
));
```

## Dashboard Interactivity

We can also add some buttons as quick filters - they will add a SQL
string to the global filter. By default, all charts will be updated when the global filter changes.

    ${component.sqlFilterButton(`Only GET`, `request__method = 'GET'`)}
    ${component.sqlFilterButton(`Only POST`, `request__method = 'POST'`)}

${component.sqlFilterButton(`Only GET`, `request__method = 'GET'`)}
${component.sqlFilterButton(`Only POST`, `request__method = 'POST'`)}

## The display() function

The `display()` function [by Observable Framework](https://observablehq.com/framework/javascript#display-value)
is used to render the chart / other values in a cell. If the value is a DOM element or node, it is inserted directly into the page.

```js echo
display("Hallo Welt");

display(component.sqlFilterButton(`Only GET`, `request__method = 'GET'`));
```

## Dashboard Design

You can use quite some pre-defined CSS classes to style your dashboards, f.e. a grid can be built like this:

<div class="grid grid-cols-4">
  <div class="card"><h1>A</h1></div>
  <div class="card"><h1>B</h1></div>
  <div class="card"><h1>C</h1></div>
  <div class="card"><h1>D</h1></div>
</div>


    <div class="grid grid-cols-4">
      <div class="card"><h1>A</h1></div>
      <div class="card"><h1>B</h1></div>
      <div class="card"><h1>C</h1></div>
      <div class="card"><h1>D</h1></div>
    </div>

<div class="grid grid-cols-2">
  <div class="card"><h1>A</h1>1 × 1</div>
  <div class="card grid-rowspan-2"><h1>B</h1>1 × 2</div>
  <div class="card"><h1>C</h1>1 × 1</div>
  <div class="card grid-colspan-2"><h1>D</h1>2 × 1</div>
</div>

    <div class="grid grid-cols-2">
      <div class="card"><h1>A</h1>1 × 1</div>
      <div class="card grid-rowspan-2"><h1>B</h1>1 × 2</div>
      <div class="card"><h1>C</h1>1 × 1</div>
      <div class="card grid-colspan-2"><h1>D</h1>2 × 1</div>
    </div>

## Observable Framework and Observable Plot

Dashica dashboards are built around **Observable Framework**, so we highly recommend to skim over some of the following docs:

- Markdown and HTML styling: https://observablehq.com/framework/markdown
- basics of JavaScript in Observable Framework: https://observablehq.com/framework/javascript
- Observable Plot - the Plotting library used by Dashica: https://observablehq.com/framework/lib/plot
- Documentation & Lots of examples on Observable Plot: https://observablehq.com/plot/
