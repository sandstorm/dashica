# Usage Philosophy

Dashica follows a Git-centric philosophy that emphasizes transparency, direct database access, and minimal abstraction layers.

## Everything in Git

Your entire dashboard lives in version control. You develop locally, using your preferred editor and tools, and deploy through standard CI/CD pipelines. This ensures reproducibility, enables collaboration, and provides a complete audit trail of changes.

## Direct Production Database Access

We recommend using IntelliJ IDEA or DataGrip and connecting directly to your production ClickHouse database (via SSH tunnel or Kubernetes port-forward). This approach gives you full IDE support—autocomplete, syntax checking, and query testing—while developing your dashboards. 

**Your SQL queries are directly runnable as-is**, making development and debugging straightforward. Simply open any `.sql` file from your project in your database IDE and execute it directly against your ClickHouse database—no modifications needed. This eliminates the typical disconnect between dashboard development and database debugging.

## Full Access to Database Power

Dashica imposes no restrictions on your SQL queries. **You have access to the full power of the underlying ClickHouse database**, including:

- Advanced analytics functions (`uniq()`, `quantile()`, window functions)
- Complex aggregations and groupings
- Array operations and `arrayJoin()` for data transformation
- User-defined functions
- All ClickHouse-specific optimizations and features

There's no abstraction layer limiting what you can do. If ClickHouse supports it, you can use it in your dashboards.

## No Intermediate Data Stores

Dashica doesn't require any additional databases or caching layers. It queries ClickHouse directly and passes results through to the UI without transformation. This keeps the architecture simple and the data flow transparent.

## No Result Modification

Dashica never modifies the results of your SQL queries. While it may modify the query itself (such as when applying global filters or adjusting time bucketing), the results are passed through as-is to the UI. This leads to a predictable and intuitive user experience—what you see in your database is what appears in your dashboard.

## Query Results should be Tidy Data

We follow the [Tidy Data](https://r4ds.had.co.nz/tidy-data.html) specification, which states:

- Each variable must have its own column.
- Each observation must have its own row.
- Each value must have its own cell.

Thus, if you have a wide format (with multiple observations per row), you can use ClickHouse
[Array Join](https://clickhouse.com/docs/sql-reference/functions/array-join) to convert it to a
[narrow format](https://en.wikipedia.org/wiki/Wide_and_narrow_data) - this is also called *unpivot* of data.

Generally, Dashica never modifies the results of your SQL queries. Sometimes, it modifies the query itself (such as when applying global filters), but the results are passed through as-is to the UI. We believe this leads to the most predictable and intuitive user experience.

