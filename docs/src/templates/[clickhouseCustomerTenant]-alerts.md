---
toc: false
---

# ${observable.params.clickhouseCustomerTenant} / Alerts

```js
import {chart, clickhouse, component, alerting} from '/dashica/index.js';

const filters = view(component.globalFilter());
const viewOptions = view(component.viewOptions());

alerting.setAlertGroupPattern(`%${observable.params.clickhouseCustomerTenant}%`);
```

${alerting.alertOverview({filters: filters})}

${alerting.alertDetails({filters: filters, viewOptions})}
