# CSV export for the table widget (technical concept)

## 1. Context and goal

Users want to take the rows of a table widget out of Dashica as a CSV file. The table caps its rows (10 000 by default)
and shows only the dashboard's time range, so copying from the screen is no option.

Goal:

- An "Export" entry in the widget's three-dot menu (top right) downloads the table's data as CSV.
- The export holds the data the table shows, with two differences: no row limit, and optionally another time range.
- Sensitive data such as IPs or usernames never leaves Dashica unless a column is explicitly allowed. Each column is
  exported unchanged, exported hashed, or not exported. The default is not exported.

## 2. Current state

### 2.1 How a table gets its data

A table is a SQL query plus title, height and limit. The limit becomes a SQL `LIMIT` on builder queries. On tables
backed by a `.sql` file or a SQL string the limit is silently ignored today; that is a bug of its own.

Each widget with a query gets a data route on the server with sub-routes for its Arrow result, debug info, raw rows and
more. All of them read the page's state from the URL (time range, filter pills, SQL filter chips) and apply it to the
query the same way. The ClickHouse client takes the output format as a parameter and streams the answer straight into
the HTTP response.

In the browser the table draws the Arrow result with Tabulator. It adds a search box over all columns and an input
filter per column header. Both filter only the loaded rows in the browser; the server never sees them.

### 2.2 Menus

The three-dot menu of a widget is a menu other extensions add entries to (Debug, chart link, Explore). An entry gets the
widget, its last result, and a helper that builds a URL to one of the widget's sub-routes with the full page state.
There is no file download anywhere in the frontend yet, only copies to the clipboard.

### 2.3 Privacy today

Dashica has no users or roles. Whoever reaches a dashboard can already fetch the full Arrow result of every widget,
including columns with IPs or usernames. The only privacy switch is `explore_enabled`, which hides raw rows "that may
hold personal data the chart aggregates away". Fields carry options such as a filter override or hiding them from the
filter popup, but nothing about export.

### 2.4 Limits

No query has a row or time cap besides the widget's own `LIMIT`. The HTTP client to ClickHouse has a 30 second timeout
that covers reading the whole response.

## 3. Proposed solution

### 3.1 Overview

```
three-dot menu "Export"
  → dialog: time range (prefilled), warning if search or header filters are active, Download
  → GET <widget data route>/csv?<page state with the chosen time range>
  → server: widget query with page filters, without LIMIT
            wrapped: SELECT <granted columns, hashed where marked> FROM (<query>)
  → ClickHouse CSVWithNames, streamed as an attachment
```

### 3.2 Export mode per field

A field gets one of three export modes:

| Mode        | In the CSV                        |
|-------------|-----------------------------------|
| `none`      | left out (default)                |
| `unchanged` | the value as ClickHouse prints it |
| `hashed`    | a keyed hash of the value         |

The mode sits on the field definition, next to the existing field options, e.g.
`sql.Field("...").WithAlias("host").Export(sql.ExportUnchanged)`. A field defined once carries its mode into every
widget that uses it.

Because the default is `none`, every column has to be granted, aggregates such as a `count` included. A table whose
fields are all `none` has nothing to export; the menu entry is then hidden.

The server builds the export from the query's select fields, matched by alias. Columns are selected by name in an outer
query, so the inner query stays as it is.

### 3.3 Hashing (decided 2026-11-10: keyed hash with a server-side secret)

A hashed column holds a keyed hash (HMAC-SHA-256 or similar) of the value. The same value gives the same hash in every
export, so rows can still be grouped and joined. Due to the secret, low-entropy values like IPv4 addresses cannot be
brute-forced back.

Where the hash is computed is open (§6). Computing it in ClickHouse is simplest, but the secret then appears in the
query text and in ClickHouse's query log. Computing it in Go means reading the CSV stream, hashing the marked columns
and writing it on.  TODO: fine: query logs are disabled

### 3.4 The export route

A new `/csv` sub-route next to the existing ones. It reuses the existing request handling, so filter pills, SQL filter
chips and the time range work as for the table itself. It differs in three points:

- no `LIMIT`,
- the outer select from §3.2,
- output format `CSVWithNames` and a `Content-Disposition: attachment` header with a file name made from the widget
  title and the time range.

ClickHouse's own response headers are not passed on. Only the table widget offers the route.

### 3.5 Dialog

"Export" opens a small dialog:

- a time range picker, prefilled with the dashboard's range,
- a note when the table's search box or a header filter is active: the export ignores them and applies only the page
  filters (decided 2026-11-10),
- a Download button, which opens the route from §3.4 as a plain download link.

## 5. Risks

- **Timeout.** The 30 second client timeout cuts long downloads. The export needs its own client or a per-request
  deadline. -> OK
- **Size.** Without `LIMIT` an export can be millions of rows and load ClickHouse heavily. See §6. -> OK
- **Privacy depends on discipline.** The default `none` keeps unknown columns out, but a field wrongly marked
  `unchanged` leaks into every export that uses it. -> OK
- **Scope of the protection.** The export rule governs files only. The Arrow result of the table itself still carries
  every column to the browser. -> OK, UI is used by humans (more trustworthy), export is for LLM agents (3rd party).

## 6. Open questions

1. **Tables from `.sql` files** have no field definitions, so with §3.2 they export nothing. Accept that, or add a way
   to declare modes for them? -> no support for  .sql file based tables widgets
2. **Secret for hashing:** reuse `app_secret`, or a dedicated secret so hashes stay stable when `app_secret` rotates? -> yes
3. **Where to hash:** in ClickHouse (secret in query log) or in Go on the stream (§3.3)? -> CLICKHOUSE
4. **Caps:** a hard row cap or a ClickHouse `max_execution_time` for exports? -> Clickhouse has limits on memory per query in place, good enough
5. **Global switch:** a config flag such as `csv_export_enabled`, default off, like `explore_enabled`? -> no, enabled
6. **CSV details:** comma or semicolon (German Excel), UTF-8 BOM, timestamps in ClickHouse's format and server timezone
   or ISO 8601 with offset? -> use clickhouse defaults
