## Alerting

The alerting system allows you to:

- Define custom alerts using SQL queries
- Set threshold conditions for triggering alerts
- Configure alert check frequencies
- Customize alert messages

### Alert Configuration

Alerts are defined in YAML files named `alerts.yaml` inside `client/content/` with the following structure:

```yaml
alerts:
  "alertName": # different alert names here
    query_path: ./alerts/my_query.sql
    # optional, if query contains placeholders
    params:
      param1: value1
      param2: value2

    # the condition to alert on
    alert_if:
      value_gt: 1000
    message: ERROR - Alert description

    # the check interval
    check_every: '@15minutes'
```

### Configuration Fields

| Field         | Description                                                      |
|---------------|------------------------------------------------------------------|
| `query_path`  | Path to the SQL query file that generates metrics                |
| `params`      | Parameters to inject into the SQL query                          |
| `alert_if`    | Condition that triggers the alert (e.g., `value_gt`, `value_lt`) |
| `message`     | Message to display when the alert triggers                       |
| `check_every` | Frequency for checking the alert (cron-like expression)          |

### SQL Query Format

Alert queries must follow a specific format:

```sql
--BUCKET: toStartOfFifteenMinutes(--NOW--)
SELECT
    toUnixTimestamp(toStartOfFifteenMinutes(timestamp)) as time,
    count(*)                                            as value
FROM
    your_table
WHERE
    your_conditions
GROUP BY
    time
    --HAVING-- time=--BUCKET--
ORDER BY
    time ASC;
```

### Important Query Elements

1. **BUCKET Definition**: The `--BUCKET:` comment is required and defines the time bucketing for alert evaluation.
   ```
   --BUCKET: toStartOfFifteenMinutes(--NOW--)
   ```

   For Monotonically Increasing Metrics (e.g., counters), you can alert on **the current time bucket**:

    ```
    -- ! use this for counters etc.
    --BUCKET: toStartOfFifteenMinutes(--NOW--)
    ```

   **For Non-Monotonic Metrics (e.g., averages), you have to use the previous complete time bucket,**
   because otherwise an alert might be thrown at the beginning of the interval based on little data, but not
   anymore after more values came in; leading to a false positive:

    ```
    -- ! use this for averages etc.
    --BUCKET: toStartOfFifteenMinutes(--NOW-- - INTERVAL 15 MINUTE)
    ```

2. **Required Columns**:

The result set needs the following

- `time_ts`: Timestamp for the data point, in Unix timestamp format: Usually: `toUnixTimestamp(toStartOfFifteenMinutes(timestamp)) as time_ts`
- `value`: The metric value to check against alert conditions

3`--HAVING--` marker, referencing the current time bucket; so the system can evaluate the current value only.

4. (Optional) **Parameterization**: Use curly braces to define parameters that can be injected:
   ```
   WHERE event_dataset = {event_dataset:String}
   ```

### Alert Conditions

Currently supported alert conditions:

| Condition  | Description                                                 |
|------------|-------------------------------------------------------------|
| `value_gt` | Triggers when the value exceeds the specified threshold     |
| `value_lt` | Triggers when the value falls below the specified threshold |


### Alert Examples: HTTP Error Alert

```yaml
alerts:
  http500ErrorsOverLimit:
    query_path: ./alerts/http_errors_per_hour.sql
    params:
      customer_tenant: oekokiste
      min_status: 500
      max_status: 599
      skip_status: 0
    alert_if:
      value_gt: 500
    message: ERROR - too many failures
    check_every: '@5minutes'
```

The corresponding SQL query:

```sql
--BUCKET: toStartOfHour(--NOW--)
SELECT
    toStartOfHour(timestamp)::DateTime64 as time, toUnixTimestamp(time) as time_ts,
    count(*) as value
FROM
    mv_caddy_accesslog
WHERE
      mv_caddy_accesslog.customer_tenant = {customer_tenant:String}
  AND mv_caddy_accesslog.status >= {min_status:Int}
  AND mv_caddy_accesslog.status <= {max_status:Int}
  AND mv_caddy_accesslog.status != {skip_status:Int}
GROUP BY
    time
ORDER BY
    time ASC
```

### Development vs. Production

- **Production**: Alerts are evaluated incrementally as scheduled by `check_every`.
- **Development**: The `BatchEvaluator` can evaluate alerts for multiple time points at once, useful for testing and
  retrospective analysis. This can be triggered by pressing the `Calculate alerts for current time range` Button
  on the alerts screen.

### Creating a New Alert

1. Run the system locally by running `dev setup; dev up`
2. **Create a SQL query file** following the format above
3. **Add an alert definition** to your alerts YAML file
4. **Test your alert** using the BatchEvaluator in development, by opening an `Alerts` screen, and pressing batch evaluation
5. **Deploy** to production

## Best Practices

1. **Choose appropriate bucketing**: Match your `--BUCKET` definition to your `check_every` interval
2. **Set reasonable thresholds**: Start with conservative thresholds and adjust based on observed patterns
3. **Use parameters**: Parameterize queries to make them reusable across different contexts
4. **Include context in messages**: Make alert messages descriptive enough to understand the issue
