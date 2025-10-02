---
toc: false
---

# Clickhouse / Table Sizes

```js
import {chart, clickhouse, component} from '/dashica/index.js';
```

# Table Sizes

```js
const tableSizes = await visibility().then(() => clickhouse.query(
    '/src/clickhouse/table_sizes/table_sizes.sql',
));
```

```js
Inputs.table(tableSizes, { rows: 20, required: false})
```

# Column Sizes

```js
const columnSizes = await visibility().then(() => clickhouse.query(
    '/src/clickhouse/table_sizes/column_sizes.sql',
));
```

```js
Inputs.table(columnSizes, { rows: 20, required: false})
```


# Changed Settings

```js
const changedSettings = await visibility().then(() => clickhouse.query(
    '/src/clickhouse/table_sizes/changed_settings.sql',
));
```

```js
Inputs.table(changedSettings, changedSettings, { rows: 10, required: false, layout: 'auto'})
```
