# Realistic Test Data

```js
import {chart, clickhouse, component} from '/dashica/index.js';
```

To create realistic test data, we generate the log messages themselves, BUT
we take production event **timestamps**. This ensures we test
the alerting based on REAL DATA and time patterns.

To add a new test set, do the following:

1) Export data from production clickhouse:

    ```bash
    dev clickhouse-client-prod
    # in Clickhouse CLI, run the queries as below, adjust date and filename
    ```

2) in `deployment/local-dev/clickhouse/02_test_data.sql`, add at the end `file(....)`

   **Do not forget to re-run the import,** either by executing the file in IntelliJ (against the dockerized
   ClickHouse at port 28123); or by running `docker compose down -v && docker compose up -d` (which re-runs
   the full fixture import).

3) in test-data.md (this file), add example printout so we can understand the shape of test data in the future.

# Calculate alerts

<form method="get" action="/api/debug-calculate-alerts">
   <button>Calculate alerts for test data</button>
</form>

pressing this button fills the `dashica_alert_events` table for the following dates (corresponding to the fixture data):

- 2025-03-20
- 2025-03-26
- 2025-04-02

# event_dataset=shop_order_failures

${debugChart("shop_order_failures", "2025-03-20", "average day - not many errors")}
${debugChart("shop_order_failures", "2025-04-02", "LOTS of errors between 02:00 and 06:00")}

```
SELECT
  timestamp
FROM mv_oekokiste_shop
WHERE customer_tenant='oekokiste'
  AND (level='error' OR level='fatal')
  AND event_type='upstream-request-failure'
  AND toDate(timestamp) = '2025-04-02'
  AND customer_project != 'oekokiste.shop_dev'
ORDER BY timestamp ASC
INTO OUTFILE 'deployment/local-dev/clickhouse/test_prod_dumps/shop_order_failures_2025-04-02.parquet'
FORMAT parquet;
```

## event_dataset=shop_successful_orders

${debugChart("shop_successful_orders", "2025-03-19", "a week before 2025-03-26 (for delta comparison)")}
${debugChart("shop_successful_orders", "2025-03-20", "corresponding entries for shop_successful_orders")}
${debugChart("shop_successful_orders", "2025-03-26", "no log entries anymore starting at 15:40")}
${debugChart("shop_successful_orders", "2025-04-02", "corresponding entries for shop_successful_orders")}

```
SELECT
  timestamp
FROM mv_oekokiste_shop
WHERE customer_tenant='oekokiste'
  AND event_type='upstream-request-success'
  AND message='successfully submitted order'

  AND toDate(timestamp) = '2025-03-19'
  AND customer_project != 'oekokiste.shop_dev'
ORDER BY timestamp ASC
INTO OUTFILE 'deployment/local-dev/clickhouse/test_prod_dumps/shop_successful_orders_2025-03-19.parquet'
    FORMAT parquet;
```



```js
async function debugChart(eventDataset, date, explanation) {
   return chart.timeBar(
           await clickhouse.query(
                   '/src/__testing/test-data/display-test-data-on-date.sql',
                   {params: {
                         event_dataset: eventDataset,
                         date: date
                      }}
           ), {
              title: `event_dataset=${eventDataset} ${date} ${explanation}`,
              height: 150,
              x: 'time',
              xBucketSize: 15*60*1000, // 15 minutes
              y: 'log_count',
           }
   )
}
```