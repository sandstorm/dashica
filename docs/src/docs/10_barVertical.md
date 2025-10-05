```js
import {chart, clickhouse, component} from '/dashica/index.js';

const filters = view(component.globalFilter());
const viewOptions = view(component.viewOptions());
```

# barVertical

The barVertical chart displays data as vertical bars, with categories on the x-axis and numeric values on the y-axis.

## Minimal Example

```js echo
display(chart.barVertical(
    await clickhouse.query(
        '/src/docs/02_first_dashboard/git_commits_by_year.sql',
        {filters}
    ), {
        viewOptions, invalidation, // Pass through global view options & Invalidation promise
        x: 'year',
        y: 'commitCount',
        
        height: 150,
        marginLeft: 60, // more space for the y axis labels on the left
    }
));
```

## Example with stacking

```js echo
display(chart.barVertical(
    await clickhouse.query(
        '/src/docs/02_first_dashboard/git_commits_by_year_and_author.sql',
        {filters}
    ), {
        viewOptions, invalidation, // Pass through global view options & Invalidation promise
        x: 'year',
        fill: 'author',
        y: 'commitCount',
        color: { legend: false }, // hide the legend, as it is too big otherwise

        height: 150,
    }
));
```

Now, to implement stacking, this works in the same way, except you need to specify the [
`fill` mark option](https://observablehq.com/plot/features/marks#mark-options). You can specify:

- A fixed CSS color string such as: `fill: "purple"`
- A column name in the data to use: `fill: "color_from_data"`
    - If this data contains CSS color strings, they are printed in the given color
    - Otherwise, the `color` scale is used to convert the values to the colors themselves. This can be configured
      further.


## Example with Faceting/Grouping

We can use the same raw data from `commits_by_author_and_year.sql` to display the chart with grouping in the X or Y
axis;
this is called faceting:

```js echo
display(chart.barVertical(
    await clickhouse.query(
        '/src/docs/02_first_dashboard/git_commits_by_year_and_author.sql',
        {filters}
    ), {
        viewOptions, invalidation, // Pass through global view options & Invalidation promise
        title: 'With faceting - commits by user, grouped by year (horizontally).',
        x: 'author',
        y: 'commitCount',
        fx: 'year',
        height: 150,
        color: { legend: false }, // hide the legend, as it is too big otherwise
    }
));
```

```js echo
display(chart.barVertical(
    await clickhouse.query(
        '/src/docs/02_first_dashboard/git_commits_by_year_and_author.sql',
        {filters}
    ), {
        viewOptions, invalidation, // Pass through global view options & Invalidation promise
        title: 'With faceting - commits by user, grouped by year (vertically).',
        x: 'author',
        y: 'commitCount',
        fy: 'year',
        
        height: 250,
        marginBottom: 100,
        marginLeft: 70,
    }
));
```


## Reference

**Specific options**

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


**Common Chart Options**

- `viewOptions`: must match the global `viewOptions` as returned by `const viewOptions = view(component.viewOptions());` in the chart header.
- `title`: The chart title
- `height`: chart height in px
- all charts use 100% of their available width and are responsive.
- `marginLeft`: margin on the left side of the chart. extend if you need space for wider labels
