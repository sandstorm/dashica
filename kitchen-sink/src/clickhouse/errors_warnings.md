---
toc: false
---

# Clickhouse / Errors+Warnings

```js
import {chart, clickhouse, component} from '/dashica/index.js';
```

# System Errors (overview / aggregated)

```js
const systemErrors = await visibility().then(() => clickhouse.query(
    '/src/clickhouse/errors_warnings/system_errors.sql',
));
```

```js
component.autoTableCombined(systemErrors, { rows: 20, required: false, layout: 'auto'})
```
