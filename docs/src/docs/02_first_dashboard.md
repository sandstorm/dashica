# Your First Dashboard

Your dashboards are all written in Markdown, with reactive JavaScript sprinkled throughout, and are placed in the `src/` folder.

Dashica dashboards are built around **Observable Framework**, so we highly recommend to at least read the following docs:

- basics of JavaScript in Observable Framework: https://observablehq.com/framework/javascript
- Observable Plot - the Plotting library used by Dashica: https://observablehq.com/framework/lib/plot

To get started, create a new file in the `src/` folder, and add the following code:

    ```js
    import {chart, clickhouse, component} from '/dashica/index.js';

    const filters = view(component.globalFilter());
    const viewOptions = view(component.viewOptions());
    ```

    # Hello World
    
    This is my first Dashica dashboard. Not very exciting yet, but it's a start :)

- The 1st line imports the dashica library, which we will use later to create charts and other components.
- The other lines line renders the global filter, which will be used to filter the data displayed in the charts:
  It is shown at the top of the page. It consists of a SQL input field, on the left, and a time-selector, on the right.

```js
import {chart, clickhouse, component} from '/dashica/index.js';

const filters = view(component.globalFilter());
```

## Example Data

Dashicy works with *any* table from Clickhouse, but the examples use snapshots from real-world data. We hope
this makes the examples more useful and approachable.

At some point in the future, we'll explain our full monitoring stack; but for now, we want to showcase the example data.

The table `mv_caddy_accesslog` contains excerpts from Web Server (Caddy) access logs. It has the following structure:

<pre>${clickhouse.showTableStructure('mv_caddy_accesslog')}</pre>


## Place your first SQL file

Create a .sql file in `src/` - we usually create a subfolder for each dashboard, and place the SQL file there;
but you are free to use any structure you like.

    -- src/02_first_dashboard/requests_per_day.sql
    SELECT
        formatDateTime(timestamp, '%d.%m.%Y') as day,
        count(*) as requests
    FROM mv_caddy_accesslog
    GROUP BY day
    ORDER BY any(timestamp) ASC;;

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

## Grouping by status code

Now, the bar chart is not very exciting, so let's also group by status code:

    -- src/02_first_dashboard/requests_per_day_and_statusGroup.sql
    SELECT
        formatDateTime(timestamp, '%d.%m.%Y') as day,
        concat(substring(toString(status), 1, 1), 'xx') as statusGroup,
        count(*) as requests
    FROM mv_caddy_accesslog
    GROUP BY day, statusGroup
    ORDER BY statusGroup ASC, any(timestamp) ASC;

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

We can also play around with other display options, like vertical and horizontal faceting:

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

## Next Steps

Congratulations, you have created your first dashboard!