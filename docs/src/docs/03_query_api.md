```js
import {chart, clickhouse, component} from '/dashica/index.js';

const filters = view(component.globalFilter());
const viewOptions = view(component.viewOptions());
```

## clickhouse.query()

The `clickhouse.query()` function is used to execute SQL queries against the Clickhouse database.

```js echo
clickhouse.query(
    '/src/docs/02_first_dashboard/requests_per_day.sql',
)
```

It returns the data in the highly efficient Apache Arrow format, which is a binary transmission format
and a columnar data format - so very well suited to big analytics data. That's why you cannot see the result
as array. You can, however, use the `.toArray()` function on the result set to convert it to an array:

```js echo
const result = await clickhouse.query(
    '/src/docs/02_first_dashboard/requests_per_day.sql',
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
