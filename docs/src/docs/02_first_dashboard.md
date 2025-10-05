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
- The 2nd line renders the global filter, which will be used to filter the data displayed in the charts:
  It is shown at the top of the page. It consists of a SQL input field, on the left, and a
  time-selector, on the right.
- The 3rd line renders the view options:
  - Display the chart as log scale, or not.

This renders as follows:

```js
import {chart, clickhouse, component} from '/dashica/index.js';

const filters = view(component.globalFilter());
const viewOptions = view(component.viewOptions());
```

## Place your first SQL file

Create a .sql file in `src/` - we usually create a subfolder for each dashboard, and place the SQL file there;
but you are free to use any structure you like.

    -- src/02_first_dashboard/git_commits_by_year.sql
    SELECT
        toString(toYear(time)) as year,
        count(*) as commitCount
    FROM git_commits
    GROUP BY year;

## Render this SQL file as a Bar Chart

Then, we can render this SQL as a Bar Chart with the following snippet: 

```js echo
display(chart.barVertical(
    await clickhouse.query(
        '/src/docs/02_first_dashboard/git_commits_by_year.sql',
        {filters}
    ), {
        viewOptions, invalidation, // Pass through global view options & Invalidation promise
        x: 'year',
        y: 'commitCount',
    }
));
```

There is quite a lot to unpack here, which we will explain in the following sections.

## clickhouse.query()

The `clickhouse.query()` function is used to execute SQL queries against the Clickhouse database.

```js echo
clickhouse.query(
    '/src/docs/02_first_dashboard/git_commits_by_year.sql',
)
```

It returns the data in the highly efficient Apache Arrow format, which is a binary transmission format
and a columnar data format - so very well suited to big analytics data. That's why you cannot see the result
as array. You can, however, use the `.toArray()` function on the result set to convert it to an array:

```js echo
const result = await clickhouse.query(
    '/src/docs/02_first_dashboard/git_commits_by_year.sql',
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

## Chart Options

The 2nd parameter of `chart.barVertical()` is an `Options` object, which minimally needs the following fields:

```
viewOptions, invalidation, // Pass through global view options & Invalidation promise 
```

`viewOptions` are required so that the chart reacts to changes in the global view options, e.g. log scale.
The `invalidation` promise is [from observable framework](https://observablehq.com/framework/reactivity#invalidation), and is a mechanism to know when the current cell
needs to re-render.

Then we need to specify the columns to use for the x and y axis:

```
x: 'year',
y: 'commitCount',
```

We try to use the configuration options from the underlying [Observable Plot](https://observablehq.com/plot/)
library, but simplified to common use cases.

## The display() function

The `display()` function [by Observable Framework](https://observablehq.com/framework/javascript#display-value)
is used to render the chart in a cell.

## Next Steps

Congratulations, you have created your first dashboard!