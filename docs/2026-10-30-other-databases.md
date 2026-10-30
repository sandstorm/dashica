# Other databases — MySQL, MariaDB, PostgreSQL as data sources (technical concept)

Status: **draft (2026-10-30)**, for review.

## 1. Context and goal

Dashica reads all data from ClickHouse. Some data we want on dashboards lives in relational databases: an `orders`
table in a shop's PostgreSQL, a `jobs` table of a queue in MariaDB, user accounts in MySQL. The question is whether
Dashica should query those databases too, and if so how:

- **Goal:** a dashboard can show charts over rows that live in MySQL / MariaDB / PostgreSQL, with the same time
  picker, filters, auto-bucketing and Arrow transport as ClickHouse charts.
- **Decision asked for:** go "the SQL parser way" (parse dashboard SQL, rewrite it per database, inject filters
  structurally) or not.
- **Constraint:** minimal complexity. The least machinery that still behaves nicely.

### The earlier parser decision

The only existing concept on this, `docs/2026-07-21-dynamic-widget-dashboard-ui.md` §1, rejected SQL parsers
(sqlglot and polyglot, a Rust port of sqlglot that also builds to WASM) for Explore: "**ClickHouse itself is the SQL
brain** (`DESCRIBE` for result schemas, `EXPLAIN` for validation); our SQL contains placeholders/params no parser
handles." The workbench concept (`docs/2026-10-28-workbench.md` §3.8) keeps that line: filters are declared fields
with bound values, put into `{{DASHICA_FILTERS}}` or `Where(...)`, "No query parsing". It lists "other database
backends" and "query understanding (AST)" under §6 *Later*. This concept picks up both items.

## 2. Current state: where Dashica is ClickHouse-specific

Dashica is ClickHouse-specific in four layers: the client, the SQL it generates, the SQL authors write, and the
features built on ClickHouse system tables.

### 2.1 Client and transport

| What | Where | ClickHouse-specific part |
|---|---|---|
| HTTP client | `lib/clickhouse/query.go` (`Client.Query`, `Execute`, `QueryToHandler`, `QueryJSON[T]`) | ClickHouse HTTP interface: `default_format`, settings as URL params, query params as `param_<name>` |
| Arrow to the browser | `QueryToHandler` streams the response body unchanged (`io.Copy`); `frontend/hosts/widgets/widgets-impl.ts` reads it with `Arrow.tableFromIPC` | ClickHouse produces the Arrow stream itself (`FORMAT Arrow`, `output_format_arrow_compression_method=none`). Dashica never builds Arrow in Go |
| Arrow compatibility | `lib/clickhouse/arrow_compat.go` (`ensureArrowCompatible`) | `DESCRIBE (<query>)`, then `SELECT * REPLACE(toString(c) AS c)` for JSON / Dynamic / Variant columns |
| Client selection | `clickhouse.Manager.GetClient(alias)`, `sql.OnDatabase(alias)`, `config.Config.ClickHouse` map | every alias is a ClickHouse server; `rendering.Dependencies.ClickhouseClientManager` is passed to every widget |

### 2.2 SQL Dashica generates

| What | Where | Generated SQL |
|---|---|---|
| Time and SQL filter | `DashboardFilters.SqlClause` in `lib/httpserver/time_range.go` | `timestamp >= 1761724800 AND timestamp <= 1761746400 AND (<free SQL>)`, compares a DateTime column to unix seconds, which only ClickHouse accepts without a cast |
| Filter injection | `SqlQuery.Build` (`WHERE (a) AND (b)`), `substitutePlaceholders` in `lib/dashboard/sql/from_file.go` (`{{DASHICA_FILTERS}}`) | plain text; dialect-neutral |
| Auto-bucketing | `lib/dashboard/sql/bucketing.go` (`bucketSizes`: `toStartOfMinute` … `toStartOfWeek`), `AutoBucket` in `fields.go`, `{{DASHICA_BUCKET}}` | `toStartOfHour(timestamp)::DateTime64` |
| Fixed buckets, gap fill | `Timestamp15Min`, `Timestamp5Min`, `WithFill` | `toStartOfInterval(timestamp, INTERVAL 5 MINUTE)`, `ORDER BY time WITH FILL STEP toIntervalHour(1)` |
| Helper fields | `JsonExtractString`, `Enum`, `Count` | `JSONExtractString(...)`, `x::String`, `count(*)` |
| Request params | `QueryHandler.HandleQuery` in `lib/httpserver/query_new.go`; `CheckboxGroup`, `TextInput` | `{__from}`, `{__to}`, `{name:String}`: ClickHouse server-side parameters |
| Debug | `QueryHandler.HandleDebug` | `EXPLAIN PLAN / PIPELINE / SYNTAX` |

### 2.3 SQL authors write

The 86 `.sql` files and the Go builders in the outer repo `src/` use ClickHouse SQL freely. Counts over `src/`:
`::` casts 257, `ILIKE` 69, `{{DASHICA_FILTERS}}` 68, `toStartOf…` 65, `INTERVAL` 26, `now()` 23, `--BUCKET--` 22,
`countIf` 14, `JSONExtract…` 15, `{{DASHICA_BUCKET}}` 12, `uniq` 9, `multiIf` 3. A typical file:

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

Every line but `count(*)` is ClickHouse-only or means something else elsewhere: `extract(s, regex)` is a regex
match in ClickHouse and a date-part function in PostgreSQL and MySQL.

### 2.4 Features built on ClickHouse system tables

| Feature | Where | Uses |
|---|---|---|
| Alert evaluation | `lib/alerting/alert_evaluator.go` (`preprocessSql`: `--BUCKET--`, `--HAVING--`), `batch_evaluator.go` (`calculateBuckets`: `arrayJoin`, `toUnixTimestamp`) | ClickHouse SQL and JSON output |
| Alert state store | `lib/alerting/alert_result_store.go` (`dashica_alert_events`, `argMax`) | a ClickHouse table. **Dashica needs a ClickHouse even if no dashboard reads from it** |
| Schema widget | `lib/dashboard/widget/schema_table.go` (`SHOW CREATE TABLE`) | ClickHouse DDL |
| Schema introspection, Explore values | `lib/clickhouse/introspect_schema.go` (`system.tables`, `system.columns`), `lib/explore/values.go` (`toString`, backticks) | system tables |
| DB sampler | `lib/db_sampler/*` (`system.parts`, sorting keys) | system tables |

## 3. Proposed solution: stay ClickHouse-only, reach other databases through ClickHouse

**Recommendation: do not add a second query path to Dashica now, and do not go the SQL parser way.** Connect
MySQL / MariaDB / PostgreSQL *to ClickHouse* (database engines, table functions, refreshable materialized views), and
let Dashica query ClickHouse as it does today. This needs no Dashica code, keeps every feature (Arrow, buckets,
filters, alerts, schema, Explore) working, and keeps dashboard SQL in one dialect.

```
 browser ──Arrow── Dashica ──HTTP── ClickHouse ─┬── MergeTree tables (logs, metrics)
                                                │
                                                ├── shop_pg  (ENGINE = PostgreSQL)  ── live ──▶ PostgreSQL
                                                │      └─ view shop_orders (column renames, casts)
                                                │
                                                └── mv_jobs (refreshable MV, every 5 min) ◀── MariaDB
```

### 3.1 Two ways to attach, chosen per table

**Live (database engine).** For small and medium tables (up to a few million rows in the selected window):

```sql
-- once, by the database operator; credentials in a ClickHouse named collection, not in dashica_config
CREATE DATABASE shop_pg ENGINE = PostgreSQL(pg_shop_readonly);   -- MySQL(...) for MySQL / MariaDB

-- a view gives the table Dashica's shape: a `timestamp` column, ClickHouse types
CREATE VIEW shop_orders AS
SELECT created_at::DateTime64(3) AS timestamp, status, toFloat64(total) AS total, country
FROM shop_pg.orders;
```

ClickHouse sends simple comparisons (`=`, `!=`, `<`, `>=`, `IN (…)`) of the WHERE to PostgreSQL / MySQL; it runs
aggregation, sorting and `LIMIT` itself on the rows that come back. So the time window filter cuts the rows at the
source, and `count()` by `toStartOfHour(timestamp)` runs in ClickHouse. Each chart refresh is one query on the source
database.

**Copied (refreshable materialized view).** For large tables, or when dashboards must not load a production database:

```sql
CREATE MATERIALIZED VIEW mv_jobs REFRESH EVERY 5 MINUTE ENGINE = MergeTree ORDER BY timestamp AS
SELECT finished_at AS timestamp, queue, state, duration_ms FROM mysql(jobs_readonly, table = 'jobs')
WHERE finished_at > now() - INTERVAL 30 DAY;
```

Dashboards then read a normal MergeTree table, as fast as the log tables. Data is up to one refresh interval old.
`MaterializedPostgreSQL` / `MaterializedMySQL` (replication) stay out: they are experimental and add operational state
we do not need for dashboards.

### 3.2 What Dashica changes

Nothing is required. Two small items may follow from verification (§5, steps 2 and 3):

1. **`SqlClause` with typed time literals.** Today it emits `timestamp >= 1761724800`. If ClickHouse does not push
   that comparison down to PostgreSQL (integer vs. timestamp), emit `timestamp >= toDateTime(1761724800)`, which
   ClickHouse folds into a constant it can send. One line in `lib/httpserver/time_range.go` plus a test; it does not
   change results for MergeTree tables.
2. **Docs page** "Data from PostgreSQL / MySQL" in `docs/dev-server/examples/docs/` (next to `queries.go`): the two
   recipes above, the `timestamp` view convention, type casts (`numeric` to `Float64` or `Decimal`, `jsonb` to
   `String`), and when to pick live vs. copied.

Dashboards use the view like any table: `sql.New(sql.From("shop_orders"), ...)`, `templates.LogOverview`-style
reuse, alerts in `alerts.yaml`, `widget.NewSchemaTable("shop_orders")` (shows the ClickHouse view DDL).

### 3.3 What the filter injection needs, and why no parser

Filters go into user SQL in two ways today, and both work without a parser, for any dialect:

- **Builder queries** (`sql.New`): Dashica builds the whole statement and appends `WHERE (…) AND (…)`.
- **SQL files**: the author marks the spot with `{{DASHICA_FILTERS}}`; `FromFile` refuses files without it
  (`SqlFile.BuildWithFS`), `FromFileWithoutFilters` opts out.

The workbench filters (§3.8 there) add declared fields with values bound as parameters; still no parsing. A parser
would only be needed to put a WHERE into SQL that has no placeholder, to find a query's base table, or to translate
functions between dialects. The first two are solved by declaration (placeholder, `sql.From`, the workbench's
`.FilterAs` / declared base table). The third is option B (§4.2), which we reject. For ClickHouse SQL, ClickHouse
itself parses: `EXPLAIN AST`, `EXPLAIN SYNTAX`, `DESCRIBE (<query>)` (already used by `ensureArrowCompatible`).

### 3.4 Trade-offs of this recommendation

| Gain | Cost |
|---|---|
| zero Dashica code; every feature keeps working | a ClickHouse is required (it already is, for the alert store) |
| one SQL dialect for all dashboards, alerts, Explore | dashboard authors write ClickHouse SQL over relational data |
| per-table choice: live or copied | live: every chart refresh is a query on the source database; copied: data is minutes old |
| credentials and grants in one place (ClickHouse named collections, read-only source roles) | the source database is reachable by every ClickHouse user with grants on that database |
| aggregation runs in ClickHouse (fast functions, `WITH FILL`, `uniq`) | live: rows in the window travel to ClickHouse before aggregation; slow for very large windows |

## 4. Alternatives considered

### 4.1 A: a dialect interface in Go, SQL written per database

A `lib/datasource` package with one implementation per database:

```go
type Source interface {
    QueryArrow(ctx context.Context, sql string, params map[string]string, w io.Writer) error // browser path
    QueryJSON(ctx context.Context, sql string, params map[string]string) ([]map[string]any, error) // alerts, tools
    Dialect() Dialect
}

type Dialect interface {
    TimeWindow(column string, fromS, toS int64) string // PG: column >= to_timestamp($1); MySQL: FROM_UNIXTIME(?)
    Bucket(column string, sizeS int64) string           // PG: date_bin('5 min', column, 'epoch'); MySQL: FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(column)/300)*300)
    BindParams(sql string, params map[string]string) (string, []any, error) // {name:String} -> $1 / ?
}
```

What it touches: `clickhouse.Manager` becomes a source manager in `rendering.Dependencies` and every caller
(`query_new.go`, `schema_table.go`, `alert_*`, `explore/*`, `speedscope_link.go`); `bucketing.go` and `AutoBucket`
ask the dialect instead of using `toStartOf…` names; `SqlClause` asks the dialect; `WithFill` has no MySQL equivalent
(Dashica fills gaps in Go or the client); `HandleDebug` gets per-dialect `EXPLAIN`; `SchemaTable` and
`IntrospectSchema` read `information_schema`. The largest piece is Arrow: ClickHouse produces Arrow itself; for
PostgreSQL and MySQL Dashica must build Arrow record batches in Go from `database/sql` rows (pgx,
go-sql-driver/mysql) with `arrow-go`'s `array.RecordBuilder` and a type mapping (timestamps with time zones,
`numeric`, enums, arrays, `jsonb`). ADBC has a PostgreSQL driver that returns Arrow directly, but it is C (cgo or the
driver manager); its MySQL support is not mature.

Estimate: PostgreSQL only, charts only (no alerts, no Explore, no sampler), ~1,500–2,500 lines of Go with tests,
2–3 weeks; each further database adds the dialect and type mapping again. Dashboards for that database are written
in its SQL; templates in `src/templates/` do not carry over.

**Rejected for now**: it is the right shape if a deployment ever must run without ClickHouse, but today no such
deployment exists, and option C gives the same charts with no code.

### 4.2 B: the SQL parser way

Parse the ClickHouse SQL of dashboards, rewrite it into PostgreSQL / MySQL, and inject filters into the AST.
Candidates: sqlparser-rs (Rust; parses ClickHouse, PostgreSQL and MySQL dialects and prints an AST back, but has no
function translation), sqlglot (Python, real transpilation with partial ClickHouse coverage) or polyglot (its Rust
port, WASM build), Go parsers that each know one dialect (vitess / TiDB for MySQL, `pg_query_go` via cgo for
PostgreSQL, AfterShip's `clickhouse-sql-parser` for ClickHouse).

Why rejected:

- **It needs everything A needs, plus the parser.** Transpiled SQL still runs on PostgreSQL, so Arrow building, type
  mapping, client manager, debug and schema per database stay. The parser only replaces "write SQL per database",
  at the price of a second toolchain (Rust via cgo or WASM in the Go server, or a Python sidecar).
- **Silent wrong numbers.** Translation fails loudly for unknown functions, and quietly for functions that exist on
  both sides with different meanings: `extract(message, regex)` vs. `EXTRACT(field FROM ts)`, `toStartOfWeek`
  (Sunday by default) vs. `date_trunc('week', …)` (Monday), time zones of `DateTime` vs. `timestamptz`, integer
  division, `uniq` (approximate) vs. `COUNT(DISTINCT)` (exact). A dashboard showing slightly wrong counts is worse
  than one that fails.
- **Our SQL is not plain SQL.** `{{DASHICA_FILTERS}}`, `{{DASHICA_BUCKET}}`, `{name:String}`, `--BUCKET--`,
  `--HAVING--` must be substituted before parsing, so the parser sees a different text than the author wrote; errors
  point to the wrong place.
- **Filter injection does not need it** (§3.3). Placeholders and declared fields cover every case we have.

**Not worth it now.** Revisit only if both are true: dashboards must run on several databases from one source, and
we accept a tested allow-list of functions. Even then, sqlglot's ClickHouse-to-PostgreSQL coverage would be the first
thing to measure, against our 86 SQL files.

### 4.3 D: DuckDB as a bridge

DuckDB attaches PostgreSQL and MySQL, and produces Arrow natively. Rejected: it is option C with a second engine
(cgo, its own SQL dialect, its own memory limits) next to the ClickHouse we run anyway.

## 5. Risks and migration

Small, reviewable steps; each stands on its own.

1. **Pick one real case.** One table in one relational database a dashboard actually needs (for example an `orders`
   table with `created_at`, `status`, `total`). Without it, stop here.
2. **Verify push-down on that case.** In `docker-compose.dev.yml` add a PostgreSQL with sample rows, attach it as in
   §3.1, and check with the PostgreSQL statement log (`log_statement = all`) that a chart's time window reaches
   PostgreSQL as a WHERE, also through the `shop_orders` view. Outcome decides step 3.
3. **If needed: typed time literal in `SqlClause`** (§3.2 item 1), one commit with test.
4. **Docs page** (§3.2 item 2), one commit.
5. **First dashboard** in the outer repo, on the view, using `AutoBucket` and the normal filters.

Risks:

| Risk | Mitigation |
|---|---|
| Live dashboards load a production database (auto-refresh, many viewers) | read-only role on a replica; `statement_timeout` on the role; copy via refreshable MV for heavy tables |
| No push-down through the view or for a predicate: full table pulled per refresh | step 2 checks it; fall back to the copied variant |
| Type surprises (`numeric` as `Decimal` reaches the browser as Arrow Decimal, which the charts do not plot as numbers) | cast in the view (`toFloat64`), documented in the docs page |
| Source data visible to every ClickHouse user with grants on the database | grant the attached database only to the Dashica user of that tenant; the source role sees only the needed tables |
| Free SQL chip and filter buttons are ClickHouse SQL | unchanged; this is one dialect for everything |

## 6. Open questions

1. **Is there a concrete need, and which database?** *Recommendation:* build nothing until one dashboard needs one
   table; start with PostgreSQL, the likeliest source.
2. **Live or copied by default?** *Recommendation:* copied (refreshable MV, 5 minutes) by default; live only for
   small tables where minutes-old data is not good enough.
3. **Who owns the attachment (named collection, `CREATE DATABASE`, views)?** *Recommendation:* the database operator
   that already creates ClickHouse users, as declarative config; not Dashica, not `dashica_config.yaml`.
4. **Does the `timestamp >= <unix seconds>` comparison push down?** *Recommendation:* verify in §5 step 2; if not,
   change `SqlClause` to `toDateTime(<s>)` for all queries.
5. **Will Dashica ever run without ClickHouse?** *Recommendation:* not planned. If it becomes a requirement, do option
   A for PostgreSQL only, charts only, with SQL written per database; still no parser.
6. **Does the workbench's "query understanding (AST)" (§6 there) need a parser?** *Recommendation:* no; declare the
   base table (workbench open question 2) and use ClickHouse's own `EXPLAIN AST` / `DESCRIBE` where more is needed.
