# Other databases — MySQL, MariaDB, PostgreSQL as data sources (technical concept)

Status: **draft (2026-10-30)**, reworked after the first review (no attaching to ClickHouse, parsers open, Arrow for
every database).

## 1. Context and goal

Dashica reads all data from ClickHouse. Some data we want on dashboards lives in relational databases: an `orders`
table in a shop's PostgreSQL, a `jobs` table of a queue in MariaDB, user accounts in MySQL. Dashica will query those
databases itself.

- **Goal:** a dashboard can show charts over rows in MySQL / MariaDB / PostgreSQL, with the same time picker,
  filters, auto-bucketing and Arrow transport as ClickHouse charts. Widgets defined in Go with the SQL builder work
  on every database; their fields keep their metadata (aliases, kinds, later the anonymization marks).
- **Decided (2026-10-30):** Dashica connects to the databases itself. ClickHouse does not attach them (no
  `mysql()` / `postgresql()` table functions, no database engines, no `MaterializedPostgreSQL`, no refreshable
  views).
- **Decision asked for:** how Dashica speaks several SQL dialects: a dialect layer in Go (A), the SQL parser way (B),
  or a combination; and for which uses a parser pays off.
- **Constraint:** minimal complexity. The least machinery that still behaves nicely.

### Earlier work this builds on

- `docs/2026-07-21-dynamic-widget-dashboard-ui.md` §1: the editor's first version uses no SQL parser; ClickHouse is
  the SQL brain there (`DESCRIBE` for result schemas, `EXPLAIN` for validation). Parsers stay open for other uses;
  this concept evaluates them.
- `docs/2026-10-28-workbench.md` §3.8: filters are declared fields with bound values, put into `{{DASHICA_FILTERS}}`
  or `Where(...)`. §6 *Later* lists "other database backends" and "query understanding (AST)".
- `docs/2026-10-30-mcp-server.md` §3.6.2 and §3.9: string columns are scrambled unless their field is marked
  `.Public()` (or `.Text()` / `.Secret()`), and MCP ad hoc queries go only through the SQL builder, never free SQL.
  The builder is therefore the place where Dashica knows what a column is.

## 2. Current state: where Dashica is ClickHouse-specific

Dashica is ClickHouse-specific in five layers: the client and transport, the SQL builder, the SQL Dashica generates,
the SQL authors write, and the features built on ClickHouse system tables.

### 2.1 Client and transport

| What | Where | ClickHouse-specific part |
|---|---|---|
| HTTP client | `lib/clickhouse/query.go` (`Client.Query`, `Execute`, `QueryToHandler`, `QueryJSON[T]`) | ClickHouse HTTP interface: `default_format` (`DefaultQueryOptions` sets `Arrow`), settings as URL params, query params as `param_<name>` |
| Arrow to the browser | `QueryToHandler` streams the response body unchanged (`io.Copy`) | ClickHouse writes the Arrow IPC stream itself. Dashica never builds Arrow in Go |
| Arrow in the frontend | `frontend/hosts/widgets/widgets.ts` (`QueryResult = Table & {...}`), `widgets-impl.ts` (`fetchQueryResult` → `Arrow.tableFromIPC(response)`) | every chart extension (`bar-vertical`, `time-line`, `heatmap`, `stats`, ...) reads an Arrow `Table`; database-neutral, as long as the server sends Arrow |
| Arrow compatibility | `lib/clickhouse/arrow_compat.go` (`ensureArrowCompatible`) | `DESCRIBE (<query>)`, then `SELECT * REPLACE(toString(c) AS c)` for JSON / Dynamic / Variant columns |
| Client selection | `clickhouse.ClientManager.GetClient(alias)`, `sql.OnDatabase(alias)`, `config.Config.ClickHouse` map | every alias is a ClickHouse server. Callers: `query_new.go` (by alias), and `"default"` hard-coded in `schema_table.go`, `speedscope_link.go`, `alert_detail.go`, `explore/*`, `alerting/*`, `httpserver/schema.go` |

The frontend needs no change for other databases: it reads Arrow and the `Dashica-*` headers. The headers stay the
same; `clickhouseSummary` is simply absent.

### 2.2 The SQL builder (`lib/dashboard/sql`)

`sql.New(sql.From(...), sql.Where(...), sql.Select(...), sql.GroupBy(...), sql.OrderBy(...), sql.Limit(...))` holds
a query as parts; `SqlQuery.Build` (`sql_builder.go`) prints them as `SELECT … FROM … WHERE (a) AND (b) GROUP BY …`.
Fields are `SqlField` values (`field_def.go`): a `definition` string, an `alias`, and a `kind` (`kindExpr`,
`kindCount`, `kindEnum`, `kindAutoBucket`; `zz_generated.enums.go`). The kind is metadata today: Explore uses it to
write `sql.Count()` instead of `sql.Field("count(*)")`, `Build` ignores it.

The definitions are ClickHouse SQL, fixed when the field is made (`fields.go`):

| Field | Definition today |
|---|---|
| `sql.Count()` | `count(*)` (alias `cnt`) |
| `sql.Enum("level")` | `level::String` |
| `sql.JsonExtractString("j", "a", "b")` | `JSONExtractString(j, 'a', 'b')` |
| `sql.Timestamp15Min()` | `toStartOfFifteenMinutes(timestamp)::DateTime64` |
| `sql.Timestamp5Min()` | `toStartOfInterval(timestamp, INTERVAL 5 MINUTE)::DateTime64` |
| `sql.AutoBucket("timestamp")` | `<fn>(timestamp)::DateTime64`; `AdjustBuckets` rebakes `<fn>` from `bucketSizes` in `bucketing.go` (`toStartOfMinute` … `toStartOfWeek`) |
| `sql.Field("…")` | the text as written |
| `sql.WithFill(step)` | `ORDER BY … WITH FILL STEP <step>` |

`AutoBucket` already keeps its column apart from its definition (`autoBucketFieldImpl.column_`), and
`withRounding` rebuilds the definition later. That is the pattern a dialect needs for every semantic field.

Use in the outer repo `src/`: 51 `sql.New`, 48 `sql.FromFile`, 14 `sql.FromFileWithoutFilters`, 324 `sql.Field(...)`.
Most `sql.Field` texts are plain column names (`host_name`, `status`, `duration_ms`), which every database reads; some
are ClickHouse expressions (`level::String`, `uniqExact(session_id)`, `event_original.error::String`,
`timestamp >= toStartOfDay(now('Europe/Berlin') - INTERVAL 30 DAY, 'Europe/Berlin')`). `WithFill` is used 0 times.

### 2.3 SQL Dashica generates around the builder

| What | Where | Generated SQL |
|---|---|---|
| Time and SQL filter | `DashboardFilters.SqlClause` in `lib/httpserver/time_range.go`, applied as `queryObj.With(sql.Where(...))` in `query_new.go` | `timestamp >= 1761724800 AND timestamp <= 1761746400 AND (<free SQL>)`: a DateTime column compared to unix seconds, which only ClickHouse accepts without a cast |
| Filter injection | `SqlQuery.Build`, `substitutePlaceholders` in `from_file.go` (`{{DASHICA_FILTERS}}`) | plain text; dialect-neutral |
| Bucket in SQL files | `{{DASHICA_BUCKET}}` (`from_file.go`) | replaced by a function name, so the file writes `{{DASHICA_BUCKET}}(timestamp)` |
| Request params | `QueryHandler.HandleQuery` (`query_new.go`, `params` → `opts.Parameters`); `CheckboxGroup`, `TextInput` | `{__from}`, `{__to}`, `{name:String}`: ClickHouse server-side parameters, sent as `param_<name>` |
| Debug | `QueryHandler.HandleDebug` | `EXPLAIN PLAN / PIPELINE / SYNTAX` |

### 2.4 SQL authors write

Two kinds of query, counted separately over the outer repo's `src/`:

| | `.sql` files (86) | Go builders (37 `.go` files) |
|---|---|---|
| `::` casts | 175 | 103 |
| `ILIKE` | 15 | 57 |
| `toStartOf…` | 58 | 7 |
| `INTERVAL` / `now()` | 30 / 19 | 6 / 5 |
| `JSONExtract…` | 6 | 16 |
| `uniq` | 0 | 11 |
| `countIf` / `multiIf` | 14 / 1 | 0 / 2 |
| Dashica placeholders | `{{DASHICA_FILTERS}}` 68, `--BUCKET--` 22, `{{DASHICA_BUCKET}}` 12 | none; the builder generates the filter and bucket |

- **`.sql` files** are ClickHouse SQL text from top to bottom; Dashica only substitutes its placeholders.
- **Go builders** are structured (`sql.New`, `From`, `Where`, fields such as `sql.Count()`, `sql.AutoBucket`), but
  the strings inside them are ClickHouse SQL too: `sql.Where("message ILIKE '%timeout%'")`,
  `sql.Field("toString(status)::String")`. The structure carries over to another dialect (§3.2); those strings do
  not.

A typical `.sql` file:

```sql
select
    {{DASHICA_BUCKET}}(timestamp)::DateTime64   as time,
    extract(message, 'status=([0-9]+)')          as status,
    count(*)                                     as count
from full_logs
where event_dataset = 'k8s.gateway.access'
  and {{DASHICA_FILTERS}}
group by time, status
order by time, status
```

Every line but `count(*)` is ClickHouse-only or means something else elsewhere: `extract(s, regex)` is a regex match
in ClickHouse and a date-part function in PostgreSQL and MySQL. These files read ClickHouse log tables; none of them
would move to another database.

### 2.5 Features built on ClickHouse system tables

| Feature | Where | Uses |
|---|---|---|
| Alert evaluation | `lib/alerting/alert_evaluator.go` (`preprocessSql`: `--BUCKET--`, `--HAVING--`), `batch_evaluator.go` (`calculateBuckets`: `arrayJoin`, `toUnixTimestamp`) | ClickHouse SQL and JSON output |
| Alert state store | `lib/alerting/alert_result_store.go` (`dashica_alert_events`, `argMax`) | a ClickHouse table: Dashica keeps needing one ClickHouse |
| Schema widget | `lib/dashboard/widget/schema_table.go` (`SHOW CREATE TABLE`) | ClickHouse DDL |
| Schema introspection, Explore values | `lib/clickhouse/introspect_schema.go` (`system.tables`, `system.columns`), `lib/explore/values.go` (`toString`, backticks) | system tables |
| DB sampler | `lib/db_sampler/*` (`system.parts`, sorting keys) | system tables |

## 3. Proposed solution: a small dialect layer, the builder renders per dialect, SQL files per database

**Recommendation: A, with the builder as the dialect-neutral layer.** Dashica gets one connection type per database
(PostgreSQL first, MySQL / MariaDB second) behind a small Go interface. Builder fields keep their meaning (kind and
arguments) and render their SQL for the dialect of the connection the query runs on, so a Go-defined widget runs on
every database. `.sql` files are written in the SQL of their database. Go builds the Arrow stream for the browser
from `database/sql` rows. No SQL parser in the execution path; a parser comes later, for query understanding only,
if a concrete feature needs it (§3.6).

```
                         ┌──────────────── Dashica (Go) ────────────────┐
 browser ◀──Arrow IPC──  │ QueryHandler ─ Source(alias) ─┬─ ClickHouse: HTTP, FORMAT Arrow (as today)
 (tableFromIPC,          │   builder.Build(dialect)      ├─ PostgreSQL: pgx → rows → arrow-go RecordBuilder
  unchanged)             │   or .sql file of that DB     └─ MySQL/MariaDB: go-sql-driver → rows → RecordBuilder
                         └──────────────────────────────────────────────┘
```

### 3.1 The dialect interface

One package `lib/datasource` with one implementation per database. The interface is the smallest set the chart path
needs; everything else (alerts, schema, Explore, sampler) stays on ClickHouse in the first version.

```go
// Source runs queries on one configured database (an alias in dashica_config.yaml).
type Source interface {
    Dialect() Dialect
    // QueryArrow runs the query and writes an Arrow IPC stream to w.
    QueryArrow(ctx context.Context, query string, args []any, w io.Writer) error
}

// Dialect is the SQL a database needs for what the builder and the filters generate.
type Dialect interface {
    Name() string                                    // "clickhouse", "postgres", "mysql"
    Bucket(column string, widthS int64) string       // a bucket of widthS seconds, as a timestamp
    TimeWindow(column string) string                 // column >= <from> AND column <= <to>, both bound as params
    Count() string                                   // count(*)
    AsString(expr string) string                     // Enum: x::String / x::text / CAST(x AS CHAR)
    JsonString(column string, path []string) string  // JsonExtractString
    Param(name, typ string, n int) string            // {name:String} / $n / ?
}
```

The ClickHouse implementation returns today's strings, so existing dashboards render byte for byte as before; golden
tests in `lib/dashboard/sql` prove it.

What each dialect renders:

| Builder / filter | ClickHouse (today) | PostgreSQL | MySQL / MariaDB |
|---|---|---|---|
| `AutoBucket`, 1 h | `toStartOfHour(ts)::DateTime64` | `date_bin('3600 seconds', ts, timestamptz '1970-01-04')` (PG 14+) | `FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(ts) / 3600) * 3600)` |
| `AutoBucket`, 1 week | `toStartOfWeek(ts)` (Sunday) | `date_bin('7 days', ts, timestamptz '1970-01-04')` (a Sunday as origin) | `FROM_UNIXTIME(FLOOR((UNIX_TIMESTAMP(ts) - 259200) / 604800) * 604800 + 259200)` |
| `Timestamp5Min` / `Timestamp15Min` | `toStartOfInterval(...)` | `date_bin('300 seconds', ...)` | as above with 300 |
| time window | `timestamp >= 1761724800 AND …` | `timestamp >= to_timestamp($1) AND timestamp <= to_timestamp($2)` | `timestamp >= FROM_UNIXTIME(?) AND …` |
| `Count()` | `count(*)` | `count(*)` | `count(*)` |
| a future `CountIf(cond)` | `countIf(cond)` | `count(*) FILTER (WHERE cond)` | `SUM(CASE WHEN cond THEN 1 ELSE 0 END)` |
| `Enum(x)` | `x::String` | `x::text` | `CAST(x AS CHAR)` |
| `JsonExtractString(j, a, b)` | `JSONExtractString(j, 'a', 'b')` | `j #>> '{a,b}'` (`j` json/jsonb) | `JSON_UNQUOTE(JSON_EXTRACT(j, '$.a.b'))` |
| parameter `name` | `{name:String}` | `$1` | `?` |
| `WithFill` | `WITH FILL STEP …` | not rendered (error at mount time) | not rendered (error at mount time) |

The week row shows why the dialect is Go code with tests and not a lookup table: ClickHouse weeks start on Sunday,
`date_trunc('week')` in PostgreSQL starts on Monday, and `date_bin` from the epoch (a Thursday) starts on Thursday.
Each rung of `bucketSizes` gets one test per dialect against a real database.

Bucketing in the database uses the database's session time zone; Dashica sets it to UTC on each connection
(`SET TIME ZONE 'UTC'` / `time_zone = '+00:00'`), as the ClickHouse buckets are UTC today.

### 3.2 The builder renders per dialect

`fieldImpl` keeps what the field means instead of only its baked text: the kind it already has, plus the arguments
(`column`, `path`, `widthS`). `Build` becomes `Build(d Dialect)`; for each semantic kind it asks the dialect, for
`kindExpr` it prints the text as written.

- `sql.Count()`, `sql.Enum`, `sql.JsonExtractString`, `sql.AutoBucket`, `sql.Timestamp5Min`, `sql.Timestamp15Min`
  render per dialect.
- `sql.Field("host_name")` works everywhere. `sql.Field("uniqExact(x)")` is ClickHouse SQL and fails on PostgreSQL
  with the database's error, as a `.sql` file would. A widget meant for several databases uses semantic fields or
  plain columns; new semantic fields (`CountIf`, `CountDistinct`, `Sum`, `Quantile`) are added when a dashboard
  needs them, each with one row in the dialect table.
- Aliases, kinds and the anonymization marks (`.Public()`, `.Text()`, `.Secret()`, MCP §3.6.2) are database-neutral:
  they live on the field, beside the rendering. The MCP structured query (MCP §3.9) composes builder queries, so it
  works on every database without extra code.
- Serialization (`serialization.go`) already writes the kind; it gains the arguments. Explore's code generator keeps
  emitting `sql.Count()` etc.

The builder does not become a SQL abstraction for everything. It covers the SELECT / FROM / WHERE / GROUP BY / ORDER
BY / LIMIT shape it has today, and the dialect renders only the fields and clauses Dashica itself generates.

### 3.3 SQL files are written per database

A `.sql` file belongs to one database: `sql.FromFile("orders-by-status.sql", sql.OnDatabase("shop"))`, written in
PostgreSQL SQL. The placeholders stay:

- `{{DASHICA_FILTERS}}` is replaced by the dialect's time window and the `Where(...)` clauses (text, as today).
- `{{DASHICA_BUCKET}}(ts)` becomes `{{DASHICA_BUCKET:ts}}` for non-ClickHouse files, replaced by the full
  `Dialect.Bucket("ts", widthS)` expression (the PostgreSQL and MySQL buckets are not one function applied to the
  column). ClickHouse files keep the old form.
- Parameters are written in ClickHouse syntax everywhere (`{name:String}`, `{__from:Int64}`); Dashica replaces each
  with `Dialect.Param` and passes the values as driver arguments, in order. The replacement is a small scanner that
  skips quoted strings and comments, the same level as `substitutePlaceholders`. Values never enter SQL text.
- `--BUCKET--` / `--HAVING--` are alert placeholders; alerts stay on ClickHouse in the first version.

### 3.4 Arrow for every database

The browser keeps receiving Arrow IPC (`fetchQueryResult` → `tableFromIPC`). For ClickHouse nothing changes. For the
other databases someone has to turn rows into Arrow:

| | Go: `database/sql` rows → arrow-go `RecordBuilder` | ADBC PostgreSQL driver | ADBC MySQL driver (ADBC Driver Foundry) |
|---|---|---|---|
| Language | pure Go: pgx (`pgx/v5/stdlib`), go-sql-driver/mysql, `github.com/apache/arrow-go/v18` | C/C++ on libpq | Go, on the ADBC Go driver framework |
| Status | libraries all stable; our mapping code is new | listed **stable** | 0.x (0.5.0, July 2026), pre-1.0 |
| Build / deploy | nothing new: one static Go binary | cgo plus `drivermgr`; `libadbc_driver_postgresql.so` shipped next to the binary | `NewDriver(alloc)` usable from Go directly, no cgo |
| Type mapping | ours: `rows.ColumnTypes()` (`DatabaseTypeName`) → Arrow type, one table per driver | theirs: `numeric` → utf8 string, `timestamptz` → timestamp UTC, `json(b)` → utf8 with `arrow.json` extension | theirs, documented less |
| Speed | row by row through `database/sql`: fine for chart-sized results (hundreds to tens of thousands of rows) | binary COPY, columnar: faster for large results | row based internally |
| Same code for both databases | yes | PostgreSQL only | MySQL / MariaDB only |

**Recommendation: build Arrow in Go with `RecordBuilder` for both PostgreSQL and MySQL / MariaDB.** One code path,
no cgo, no shared library to deploy, and a type mapping we choose for the charts. Dashica's results are chart-sized
(`maxBuckets` in `bucketing.go` keeps a time chart at 721 buckets per series), so columnar transfer buys nothing visible. The ADBC
PostgreSQL driver's `numeric` → string mapping would need a cast or a conversion in Dashica anyway for charts to
plot it. Revisit ADBC only if a dashboard needs results of hundreds of thousands of rows.

The mapping, written once in `lib/datasource/arrowrows` (scan into typed holders, append to the matching builder,
`ipc.NewWriter` on the HTTP response, one record batch per 8,192 rows):

| PostgreSQL | MySQL / MariaDB | Arrow | Note |
|---|---|---|---|
| `int2`, `int4`, `int8` | `TINYINT` … `BIGINT` (`UNSIGNED` → unsigned) | Int16 / Int32 / Int64 (UInt*) | `TINYINT(1)` stays Int8 |
| `float4`, `float8` | `FLOAT`, `DOUBLE` | Float32 / Float64 | |
| `numeric` | `DECIMAL` | Float64 | charts need numbers; precision beyond float64 is lost, documented |
| `bool` | — | Bool | |
| `text`, `varchar`, `uuid`, `enum`, `inet` | `VARCHAR`, `TEXT`, `ENUM`, `SET` | Utf8 | |
| `timestamptz`, `timestamp` | `DATETIME`, `TIMESTAMP` (`parseTime=true`, `loc=UTC`) | Timestamp(ms, "UTC") | same unit the time charts read from ClickHouse `DateTime64(3)` |
| `date` | `DATE` | Date32 | |
| `json`, `jsonb`, arrays, other | `JSON`, `BLOB`, other | Utf8 (text form) | as `ensureArrowCompatible` does for ClickHouse JSON |

An unknown type falls back to Utf8 of the driver's text form; the chart then shows it as a category.

### 3.5 Configuration, connections, what stays on ClickHouse

- `dashica_config.yaml` gets one map per database kind beside `clickhouse:`, same shape (alias, URL / DSN, user,
  password):

  ```yaml
  postgres:
    shop: { dsn: "postgres://dashica_ro@db-replica:5432/shop?sslmode=require", password: "…" }
  mysql:
    jobs: { dsn: "dashica_ro@tcp(jobs-db:3306)/jobs?parseTime=true&loc=UTC", password: "…" }
  ```

  Aliases are unique across all maps, so `sql.OnDatabase("shop")` picks the source.
- Each connection is a `database/sql` pool with a small max (4), a read-only role, and a statement timeout set per
  session (`statement_timeout` / `max_execution_time`), so a dashboard with auto-refresh cannot hold a production
  database.
- `rendering.Dependencies.ClickhouseClientManager` stays; a `SourceManager` beside it serves `QueryHandler.Run`.
  The hard-coded `GetClient("default")` callers (alerts, schema, Explore, sampler, speedscope) keep using ClickHouse.
- The free SQL filter chip is SQL of the widget's database. On a PostgreSQL widget, the user writes PostgreSQL.
- `HandleDebug` gets `EXPLAIN` per dialect (PostgreSQL `EXPLAIN`, MySQL `EXPLAIN FORMAT=TREE`).

### 3.6 Where a SQL parser pays off

The four uses, judged separately:

| Use | Worth it? | Why |
|---|---|---|
| (i) Transpile ClickHouse SQL to other dialects | **no** | the `.sql` files read ClickHouse log tables and never move; new files for another database are written in its SQL. Transpiling risks silently wrong numbers (§4.2) |
| (ii) Structural filter injection without placeholders | **no** | builder queries get `WHERE` from `Build`, files mark the spot with `{{DASHICA_FILTERS}}`, workbench filters are declared fields with bound values. Every case we have is covered |
| (iii) Query understanding: output columns, source tables, which columns an output expression uses | **yes, later, for named features** | it answers questions the database's `DESCRIBE` cannot: which source column an output alias of a `.sql` file comes from (to check a `.Public()` mark against the column, MCP §3.6.2), the expression behind an alias (click-to-filter on `extract(message, …) as status` filters on the expression, not the alias), the base table for Explore |
| (iv) Validation | **no** | each database validates its own SQL (`EXPLAIN`, `DESCRIBE`, `PREPARE`) with its real rules; a parser's view of validity drifts from the server's |

For (iii), Dashica parses only; it never prints changed SQL back for execution. A parser that misreads a query then
gives a wrong hint (a missing click-to-filter, a warning too many), never a wrong number. The first candidate is
AfterShip's `clickhouse-sql-parser` (Go, typed AST, `Walk` / `Find`; its README lists SigNoz and Altinity MCP as users),
because the files that need understanding are the ClickHouse ones. For PostgreSQL, `pg_query_go` (PostgreSQL's own
parser, via cgo) would follow only when a PostgreSQL feature needs it. Before (iii) is built, the builder already
answers these questions for every Go-defined widget: it knows each field's definition, alias, kind and mark.

## 4. Alternatives considered

### 4.1 A without builder rendering: every query written per database

Keep `Build()` ClickHouse-only and require hand-written SQL (files or `sql.Field` text) for other databases.
Smaller (no change in `lib/dashboard/sql`), but Go-defined widgets, `templates.*` and the MCP structured query would
not run on PostgreSQL, and `AutoBucket` would need a per-database placeholder anyway. Rejected: the builder change is
local to one package and is what makes metadata-carrying widgets work everywhere.

### 4.2 B: the SQL parser way for execution

Parse the ClickHouse SQL of dashboards, transpile it to PostgreSQL / MySQL, inject filters into the AST, and run the
result.

Candidates:

| Parser | Language, use from Go | Dialects | Transpiles | Notes |
|---|---|---|---|---|
| sqlparser-rs | Rust; from Go via cgo, or via wazero with our own `wasm32-wasip1` wrapper (feasible, no ready-made Go binding) | ClickHouse, PostgreSQL, MySQL and more | no: AST and printing back, no function translation | the parser behind DataFusion |
| polyglot | Rust port of sqlglot; Go SDK via PureGo over the native `polyglot-sql-ffi` library (a `.so` / `.dylib` to ship per platform); WASM build for JS hosts | 30+, incl. ClickHouse, PostgreSQL, MySQL | yes | runs sqlglot's fixture suite; also lineage and analysis |
| sqlglot | Python; a sidecar process | 30+ | yes | the reference; ClickHouse is one of its dialects |
| vitess / TiDB parser | pure Go | MySQL | no | |
| `pg_query_go` | Go over libpg_query (cgo) | PostgreSQL (the real parser) | no | |
| AfterShip `clickhouse-sql-parser` | Go | ClickHouse | no | AST, `Format`, `Walk`, `Transform` |

Running a WASM parser inside Go with wazero is feasible (pure Go runtime, no cgo; projects such as `zetasql-wasm` and
the stoolap Go driver do it with C++ and Rust engines). For sqlparser-rs we would write and maintain the Rust wrapper
and a JSON interface for the AST ourselves.

Why rejected for execution:

- **It needs everything A needs, plus the parser.** Transpiled SQL still runs on PostgreSQL: connections, Arrow
  building, type mapping, debug and the bucket and time-window SQL stay. The parser only replaces "write SQL per
  database", at the price of a second toolchain (native library, WASM module or Python sidecar).
- **Silently wrong numbers.** Translation fails loudly for unknown functions and quietly for functions that exist on
  both sides with different meanings:
  - `extract(message, 'regex')` (regex) vs. `EXTRACT(field FROM ts)` (date part);
  - `toStartOfWeek` (Sunday) vs. `date_trunc('week', …)` (Monday);
  - `uniq` (approximate) vs. `COUNT(DISTINCT …)` (exact): numbers differ by design;
  - time zones: ClickHouse `DateTime` carries the column's time zone, PostgreSQL `timestamp` has none and
    `timestamptz` uses the session's;
  - integer division: `7 / 2` is `3.5` in ClickHouse and MySQL, `3` in PostgreSQL;
  - `count()` returns UInt64 in ClickHouse and bigint elsewhere; `sum` of integers widens differently.
  A dashboard showing slightly wrong counts is worse than one that fails.
- **Our SQL is not plain SQL.** `{{DASHICA_FILTERS}}`, `{{DASHICA_BUCKET}}`, `{name:String}`, `--BUCKET--`,
  `--HAVING--` must be substituted (or replaced by dummy tokens) before parsing, so the parser sees a different text
  than the author wrote, and errors point to the wrong place.
- **Nothing to transpile.** The existing `.sql` files read ClickHouse log tables; the relational data needs new
  queries anyway.

Revisit only if one dashboard source must run unchanged on several databases and we accept a tested allow-list of
functions; then measure polyglot against our 86 files first.

### 4.3 Attaching the databases to ClickHouse

`ENGINE = PostgreSQL(...)` / `MySQL(...)` databases, `postgresql()` / `mysql()` table functions, refreshable
materialized views, `MaterializedPostgreSQL`. It would need no Dashica code and keep one dialect. **Rejected
(decided 2026-10-30): Dashica connects to the databases itself.**

### 4.4 DuckDB as a bridge

DuckDB attaches PostgreSQL and MySQL and produces Arrow natively. Rejected: a second engine (cgo, its own dialect,
its own memory limits) between Dashica and the source, for what pgx plus `RecordBuilder` does in pure Go.

## 5. Risks and migration

Small, reviewable steps; each is one commit (or a short series) with tests, and each stands on its own.

1. **Pick one real case.** One PostgreSQL table a dashboard needs (for example `orders` with `created_at`, `status`,
   `total`). Without it, stop here.
2. **Fields keep their meaning.** In `lib/dashboard/sql`, `fieldImpl` stores kind and arguments; a `Dialect`
   interface with the ClickHouse implementation; `Build(d)`. Golden tests: every existing builder test renders
   byte-identical SQL. Serialization carries the arguments (regenerate, never hand-edit `zz_generated.*`).
3. **PostgreSQL dialect.** Buckets (every `bucketSizes` rung, week on Sunday), time window, `Enum`,
   `JsonExtractString`, `Param`. Tests against a PostgreSQL in `docker-compose.dev.yml`: bucket boundaries equal
   ClickHouse's for the same timestamps.
4. **Arrow from rows.** `lib/datasource/arrowrows` with the mapping table (§3.4); tests decode the stream with
   arrow-go's IPC reader and compare types and values, including NULLs.
5. **Source and config.** `postgres:` map, `SourceManager`, pool limits, session settings (UTC, statement timeout,
   read-only); `QueryHandler.Run` picks the source by alias; `{{DASHICA_BUCKET:col}}` and the parameter scanner for
   files. Frontend untouched.
6. **First dashboard** in the outer repo, on the real table, with `AutoBucket`, `Count`, `Enum` and the normal time
   filter.
7. **MySQL / MariaDB** (dialect, mapping rows, `mysql:` map) when a dashboard needs it.
8. **Later, only with a named feature:** a ClickHouse parser for query understanding (§3.6 (iii)).

Risks:

| Risk | Mitigation |
|---|---|
| Builder refactor changes existing ClickHouse SQL | golden tests in step 2; the ClickHouse dialect returns today's strings |
| Dashboards load a production database (auto-refresh, many viewers) | read-only role on a replica, small pool, statement timeout per session |
| Bucket boundaries differ from ClickHouse (week start, time zone) | UTC per session; tests per rung against real databases (step 3) |
| `numeric` / `DECIMAL` lose precision as Float64 | documented; a widget that needs exact decimals casts to text |
| A widget with `sql.Field("uniqExact(x)")` mounted on PostgreSQL | fails with the database's error on first query; a mount-time check can reject `WithFill` and unknown dialect features early |
| Type mapping misses a type | fallback to Utf8, a test per type in the mapping table |
| Alerts, schema widget, Explore, sampler on PostgreSQL | out of scope in the first version; they keep using ClickHouse |

## 6. Open questions

1. **Which database and table first?** *Recommendation:* PostgreSQL, one table one dashboard needs; MySQL / MariaDB
   when a dashboard needs it.
2. **Alerts on PostgreSQL data?** *Recommendation:* not in the first version. When needed, the alert query renders
   through the same dialect (`--BUCKET--` → `Dialect.Bucket`), and the alert store stays in ClickHouse.
3. **`{{DASHICA_BUCKET:col}}` for every file, or only for non-ClickHouse files?** *Recommendation:* accept both forms
   in ClickHouse files, require the new form elsewhere; no migration of the 12 existing files.
4. **Parameter syntax in non-ClickHouse files: `{name:String}` or the native `$1` / `?`?** *Recommendation:*
   `{name:String}` everywhere, translated by Dashica; widgets (`CheckboxGroup`, `TextInput`) send named values, and
   one syntax keeps them working on every database.
5. **`WithFill` on other databases?** *Recommendation:* reject at mount time (unused today). If a chart needs gaps
   filled, fill in Go while building Arrow, since the bucket size is known.
6. **Explore and schema introspection on PostgreSQL?** *Recommendation:* later, via `information_schema.columns`
   behind one more method on the dialect, when someone explores relational data.
7. **When do we add a parser, and which?** *Recommendation:* when click-to-filter on `.sql` expressions or the MCP
   mark check (§3.6 (iii)) is planned; start with AfterShip's `clickhouse-sql-parser`, parse only, never execute its
   output. Polyglot (native library) and wazero-hosted Rust parsers only if a pure-Go parser cannot answer the
   question.
8. **ADBC instead of our own Arrow building?** *Recommendation:* no for now; measure first if a widget needs results
   of hundreds of thousands of rows.

## Sources

- ADBC PostgreSQL driver (C/C++ on libpq, stable, type mapping): https://arrow.apache.org/adbc/current/driver/postgresql.html
- ADBC Driver Foundry MySQL driver (Go): https://pkg.go.dev/github.com/adbc-drivers/mysql, maturity and MariaDB
  driver: https://lefred.be/content/a-native-adbc-driver-for-mariadb/
- polyglot (Rust port of sqlglot, Go SDK over FFI): https://github.com/tobilg/polyglot
- AfterShip clickhouse-sql-parser: https://github.com/AfterShip/clickhouse-sql-parser
- WASM in Go via wazero, examples: https://pkg.go.dev/github.com/glassmonkey/zetasql-wasm@v0.12.1,
  https://stoolap.io/docs/drivers/go-wasm/
