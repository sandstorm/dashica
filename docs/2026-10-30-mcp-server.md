# MCP server with anonymization (technical concept)

Status: **draft (2026-10-30)**, reworked after the first review (key, scrambled by default, no in-process HTTP,
builder-only queries, Keycloak, connections, audit log in the UI).

## 1. Context and goal

An AI assistant (Claude Code, Claude Desktop, any MCP client) should be able to look at Dashica's observability
data the way an engineer does: find the dashboard for the k8s gateway, read the "requests by status code" chart for
the last 6 hours, see which alerts fired last night, and reason about it. The Model Context Protocol (MCP) is the
standard way to give an assistant such tools.

The data is personal and confidential. Request logs contain client IPs, user ids, emails in URLs and query strings,
session tokens and `Authorization` headers, and tenant / project names in hostnames (`shop-a.example.com`). The
assistant runs at a cloud provider, so **everything a tool returns leaves our infrastructure**. Anonymization is
therefore not a filter added at the end but the part of the design every tool result passes through.

Goal of this concept:

- A small MCP server that lists dashboards and widgets, reads a widget's data for a time range, and reads alerts.
- Anonymization on every result, with pseudonyms that stay joinable inside one conversation.
- Hard limits (time range, rows, bytes, execution time) so an assistant cannot overload ClickHouse.
- **Connections** a user creates in the workbench for a purpose, with a scope and an end ("investigate the 502s on
  the gateway, aggregates only, for 2 hours"), and an **audit log in the UI** that shows what each connection did:
  every tool call, the SQL it ran and what it returned.
- Login and permissions through Keycloak (OIDC), no tokens in Dashica's config.
- A first version that can be built and reviewed in a few small steps; ad hoc queries only through the SQL builder,
  never free SQL.

Guiding principle (as in the workbench concept): the least machinery that still behaves nicely.

## 2. Current state

### 2.1 How a widget query runs

| Step | Where | What happens |
|---|---|---|
| Registration | `dashica.go` `RegisterDashboard` → `dashboard.Builder.CollectHandlers` | each page mounts its widgets below `<page>/api/<id>/` via `widget.Mount` (`lib/dashboard/widget/widget_common.go`); the widget tree is serialized once into `<page>/page.json` (`lib/dashboard/page_json.go`) |
| Widget handler | `widget.queryHandler(deps, query)` | serves `/query` and `/debug` for one `sql.SqlQueryable`; widgets add their own options first (`Table.Handler` adds `sql.Limit(b.limit)`) |
| Query resolution | `httpserver.QueryHandler.HandleQuery` (`lib/httpserver/query_new.go`) | picks the ClickHouse client by `queryObj.Database()`, reads `params` (widget params → `param_<name>`) and `filters` (`DashboardFilters`: time range + free SQL), resolves the time range once (`ResolveTimeRange(time.Now())`), adds `Where(filters.SqlClause(...))`, adjusts buckets (`AdjustBuckets`), builds SQL with `sql.BuildWithFS` |
| Execution | `clickhouse.Client.QueryToHandler` (`lib/clickhouse/query.go`) | HTTP GET to ClickHouse, `default_format=Arrow`, streams the body unchanged to the browser |

`HandleDebug` repeats the first half of `HandleQuery` (params, filters, time range, buckets, build) line by line.
The Go side never decodes the result: it is Arrow bytes piped through, and there is no Arrow library in `go.mod`.
`clickhouse.QueryJSON[T]` exists for JSON results (used by alerting).

### 2.2 What is machine-readable already

- `/workbench.json`: the menu (groups → dashboards with URL and title), `DashicaImpl.serveWorkbenchJson`.
- `<page>/page.json`: title, default time range, filter buttons, and the widget tree (`widget.Node`: `type`, `props`
  including `title`, `dataUrl`). SQL expressions never leave the server.
- Alerts: definitions are parsed from `alerts.yaml` (`alerting.ParseAlertConfiguration`, `AlertDefinition`: id,
  query path, condition, message, `check_every`); `AlertManager` holds them (only `GetAlertDefinition(id)` is public,
  no list method). Alert events live in the ClickHouse table `dashica_alert_events` (client `alert_storage`), read by
  `QUERY_ALERTS_QUERY` in `lib/httpserver/query_alerts.go`.

### 2.3 Existing anonymization code

`lib/db_sampler/anonymize.go` + `defaults.go` already anonymize table samples for AI context (`cmd/db-anonymize`,
the parent repo's `db-context/`):

- `Processor func(field string, value any) (any, skip bool)`, composed with `Chain`, applied per row by
  `AnonymizeRow` (recurses into maps and arrays).
- `StructuralColumns`: rules by column name (`client_ip` → scramble IP, `email` → scramble, `user_agent` → replace).
- `TextRegex`: emails (also URL-encoded `%40`), IPv4, IPv6, IBAN; `RedactHighEntropyTokens(4.8, 12)` for secrets.

Two properties matter for MCP:

- The scrambling is **unkeyed** (crc32 of the value). The same input gives the same output everywhere, so it is
  joinable, but it is also reversible by brute force: all 2^32 IPv4 addresses can be hashed in seconds, and a
  scrambled email keeps its length and shape. That is acceptable for schema samples, not for live query results:
  **the MCP server pseudonymizes with a secret key** (§3.6.3).
- Rules match **column names**. Dashboard queries alias freely (`JSONExtractString(event_original, 'request',
  'client_ip') AS ip`), so a name-only rule misses columns; the regex layer is the safety net. The MCP server
  therefore turns it around: every string is scrambled unless the dashboard marks it as not secret (§3.6.2).

### 2.4 Data and access

- **Tables depend on the instance.** Dashica knows no tables; each instance's dashboards (Go, `.sql` files) name
  them. The anonymizer therefore works on query results and on what the dashboards declare, never on a list of
  tables. Example from one instance: a log table with tenant, project, host, level, message and the original
  event as a JSON blob, plus materialized views per log source; most personal data sits in the JSON blob and the
  message. (The concrete setup of our instances is still to be added here.)
- ClickHouse connections are configured per alias in `dashica_config*.yaml` (`clickhouse.<alias>.url/user/password/
  database`, `config.ClickHouseConfig`); one instance uses a read-only user for `default` and a writing user for
  `alert_storage`, the other one database user for both. **All authenticated ClickHouse users are trusted**,
  including reading `system.query_log` across tenants.
- Dashica itself has no user authentication: `config.AuthConfig` is marked "currently not supported"; protection
  is whatever sits in front of the deployment. Putting Dashica behind Keycloak is being considered (§3.5).
- The workbench concept (`docs/2026-10-28-workbench.md` §6) lists "MCP server with built-in anonymization" as
  later work and notes that every query goes through one path (`QueryState` → handler), the single place for an
  anonymization step. Open question 6 there ("declared per column in Go, or in ClickHouse; reversible or not") is
  answered by this concept.

### 2.5 Go MCP SDK

`github.com/modelcontextprotocol/go-sdk` is the official SDK (maintained with Google), at v1.7.0 (supports MCP spec
2026-07-28 and older versions back to 2024-11-05). It has `mcp.Server` with typed tool handlers (input / output
structs → JSON schema), `mcp.StdioTransport`, and `mcp.NewStreamableHTTPHandler` (an `http.Handler`). Spec
2026-07-28 is served only in **stateless** mode (`StreamableHTTPOptions.Stateless`); stateful clients negotiate
down to 2025-11-25. The `auth` package has `RequireBearerToken(verifier, opts)` as `http.Handler` middleware and
OAuth Protected Resource Metadata helpers. Releases target the supported Go versions; Dashica's `go.mod` says
`go 1.24.0`, so adding the SDK may raise it (local toolchain is 1.25.5).

## 3. Proposed solution

### 3.1 Overview

The MCP server is **a handler inside the Dashica binary** at `/mcp` (streamable HTTP, stateless), switched on per
instance. Its tools read a **catalog** of the registered pages and their widgets' queries (filled while the
dashboards mount), run a widget's query through the same Go function the HTTP handler uses, ask for JSON instead of
Arrow, run every result through one anonymizer and size limiter, and return the result as tool output. No HTTP
request is made inside the process.

```
 MCP client (Claude Code)                     Dashica binary
 ─────────────────────────                    ──────────────────────────────────────────────────────────
  POST /mcp  Authorization: Bearer <Keycloak access token>  ──►  auth (JWT → Grant)  ──►  mcp.Server (go-sdk, stateless)
                                                                         │ tool call
                                                                         ▼
                                            lib/mcp tools ──► catalog.Pages() / catalog.Widget(page, id)
                                                  │        (filled in Mount: page, id, type, title, fields, query)
                                                  │──► QueryHandler.Run(ctx, query, state, JSONCompact, settings)
                                                  │        (the function HandleQuery calls; same SQL)
                                                  ▼
                                            lib/anonymize  (scrambled by default, fields marked in Go, keyed pseudonyms)
                                                  ▼
                                            limiter (rows, string length, result bytes) ──► tool result JSON
                                                  └──► audit log (zerolog, dataset dashica.mcp; no result data)
```

### 3.2 Transport and placement

**Streamable HTTP inside the Dashica binary**, mounted only when `mcp.enabled: true` in `dashica_config*.yaml`:

- It reuses everything that is already running: the registered pages, the ClickHouse clients and their credentials,
  the alert manager. No second deployment, no ClickHouse credentials on laptops.
- The client configures only the URL (`claude mcp add --transport http dashica https://dashica.example/mcp`) and
  logs in through Keycloak when the server asks (§3.5). Clients that only speak stdio use a generic stdio-to-HTTP
  bridge.
- **Stateless** mode: spec 2026-07-28, no server-side session to keep, works behind any load balancer. The few
  things that need continuity across calls (the pseudonym key, §3.6) derive from the user (the token's subject) and the
  day instead of a session.

Wiring: a new package `lib/mcp` with `func Handler(deps rendering.Dependencies, catalog *rendering.Catalog, cfg
config.MCPConfig, dictionaries []anonymize.Dictionary) http.Handler`. `DashicaImpl` gets one method,
`EnableMCP(dictionaries ...anonymize.Dictionary) Dashica`, which the instance's `main.go` calls after registering
the dashboards; it mounts the handler at `/mcp`. The dictionaries are the only instance-specific Go code (they name
the identifier columns of its tables).

### 3.3 Tools (first version)

All tools are read-only (`readOnlyHint: true`). Inputs are small structs; output is JSON text plus a structured
result.

| Tool | Input | Returns | Source |
|---|---|---|---|
| `list_dashboards` | — | groups → `{url, title}` | `/workbench.json` |
| `describe_dashboard` | `url` (`/p/k8s_gateway`) | title, default time range, filter buttons (titles only), widgets flattened: `{widget_id, type, title, has_data}` | `<page>/page.json` |
| `get_widget_data` | `url`, `widget_id`, `time` (preset `"6h"` or `from`/`to`), optional `filter_button` titles | `{columns: [{name, type}], rows, row_count, truncated, resolved_time_range, notes}` | `<page>/api/<id>/query` |
| `list_alerts` | — | per alert: id, message template, condition, `check_every`, current status | `AlertManager` + `AlertResultStore` |
| `get_alert_history` | `time`, optional `alert_id` | state changes `{alert_id, status, start, end, message}` | `dashica_alert_events` |

What is deliberately left out of the first version:

- **Free SQL, ever.** The assistant chooses among the queries the dashboard authors wrote, and later composes ad hoc
  queries from their sources and fields through the builder (§3.9). That keeps the anonymization bounded (known
  fields with their marks) and needs no new trust boundary in ClickHouse.
- **The free-SQL filter chip.** Filter buttons are Go-declared SQL and can be toggled by title; structured filters
  (workbench §3.8) can be offered once they exist, since they carry only ids and bound values.
- `/debug` (SQL text and EXPLAIN): the SQL is internal; it contains no result data but can contain literal values
  from filter buttons.
- MCP resources and prompts. Tools are what current clients use best; `page.json` could later be a resource.

### 3.4 The catalog and the query function

Two Go-level changes replace any HTTP inside the process:

- **A catalog of the widgets' queries.** `rendering.DashboardContext` gets `Catalog *Catalog`. Where a widget with
  data mounts its handler (`queryHandler` in `lib/dashboard/widget/widget_common.go`, called from each widget's
  `Mount`), it also adds an entry: `Catalog.Add(CatalogEntry{Page: ctx.CurrentHandlerUrl, Id, Type, Title, Fields,
  Query})`. `RegisterDashboard` adds the page (title, group, default time, filter buttons). The MCP tools read
  `Catalog.Pages()` and `Catalog.Widget(page, id)`; the fields carry the `.Public()` / `.Text()` / `.Secret()` marks
  (§3.6.2). The catalog is filled once at start and read-only afterwards.
- **One query function.** `HandleQuery` and `HandleDebug` in `lib/httpserver/query_new.go` today read the request,
  resolve the time range, add the filter, adjust buckets, build the SQL and run it. That body becomes
  `func (qh QueryHandler) Run(ctx context.Context, query sql.SqlQueryable, state QueryState, format string,
  settings map[string]any, out io.Writer) (RunInfo, error)` (`QueryState`: filters and params, as the workbench
  concept §3.8 names it; `RunInfo`: resolved time range, bucket size). `HandleQuery` parses the request into a
  `QueryState`, calls `Run` with Arrow and writes the headers from `RunInfo`; `HandleDebug` shares the same
  preparation. MCP calls `Run` with `JSONCompact`, its ClickHouse limits (§3.7) and a buffer.

The widget's own options stay in effect (a `Table` keeps its `Limit`), and a widget an engineer sees in the browser
returns the same numbers to the assistant. The widget id is the one in `page.json`'s `dataUrl` (`/p/k8s_gateway/api/3`
→ `3`, or an author-chosen id like `status_codes`); ids from the render-order counter shift when a page changes,
which is fine within one conversation, and authors can pin important widgets with `.Id(...)`.

Trade-off: every widget type that has data registers in the catalog (one line in the shared `queryHandler`, so in
practice one place), and the alert widgets register their own entries. In return MCP depends on Go types, not on
handler URLs and headers.

### 3.5 Authentication and authorization: Keycloak (OIDC), no static tokens (decided 2026-10-30)

Our instances run behind Keycloak. Dashica gets OIDC itself, for the UI and for MCP, with Keycloak as the
authorization server; there are no tokens or token hashes in Dashica's config.

```yaml
auth:
  oidc:
    issuer: https://sso.example/realms/sandstorm      # discovery: /.well-known/openid-configuration
    client_id: dashica                                  # confidential client for the UI login
    client_secret_env: DASHICA_OIDC_CLIENT_SECRET       # from the environment, never in the file
    mcp_audience: dashica-mcp                           # audience of access tokens for /mcp
    roles_claim: resource_access.dashica.roles
```

- **UI: Dashica as OIDC client** (authorization code flow with PKCE, `golang.org/x/oauth2` +
  `github.com/coreos/go-oidc`). Unauthenticated requests to `/p/…` redirect to Keycloak; the callback sets an
  encrypted session cookie (subject, name, roles, expiry). This replaces whatever protects the deployment today and
  gives the workbench a user (main menu, §3.10; "Permissions per dashboard", workbench §6).
- **MCP: Dashica as protected resource** (MCP authorization spec). `/mcp` answers 401 with
  `WWW-Authenticate: Bearer resource_metadata=…`; Dashica serves the OAuth Protected Resource Metadata (RFC 9728,
  `/.well-known/oauth-protected-resource`) naming the Keycloak realm. The MCP client (Claude Code) then logs the
  viewer in at Keycloak in the browser and sends Keycloak's access token. Keycloak documents itself as an MCP
  authorization server; clients register through the Client ID Metadata Document, which Keycloak supports as an
  **experimental** feature (`--features=cimd` plus a client policy), or through dynamic client registration.
- **Checking a token:** signature against the realm's keys (JWKS, cached), issuer, audience `dashica-mcp`, expiry;
  the SDK's `auth.RequireBearerToken` with this verifier puts a `Grant` into the request context. The SDK also has
  the protected resource metadata helper.
- **Grant from Keycloak roles:** `dashica-mcp` (may use MCP at all), `dashica-mcp-rows` (else aggregates only,
  §3.6.6), and page access from groups or roles (`dashica-pages:k8s_gateway*`) as the UI uses them. The audit log
  names the subject. A connection (§3.10) narrows the grant further; the pseudonym key derives from it (§3.6.3).
- `list_dashboards` and `describe_dashboard` show only allowed pages, `get_widget_data` refuses others; alerts are
  allowed by their group (the `alerts.yaml` path) with the same globs.

Keycloak setup (per realm, by the operator): a confidential client `dashica` for the UI, a client scope / audience
mapper for `dashica-mcp`, the roles above, and CIMD or dynamic client registration for MCP clients. Check the
Keycloak version in use: CIMD is experimental, and resource indicators (RFC 8707) differ by version.

### 3.6 Anonymization

#### 3.6.1 Where: in Go, on the JSON result

The anonymizer runs in Go on the decoded `JSONCompact` result, after ClickHouse and before anything leaves the
process. Reasons:

- **The key stays secret.** Keyed pseudonyms in ClickHouse SQL (`sipHash64Keyed(key, client_ip)` in a view or a
  rewritten query) put the key into query text, which lands in `system.query_log`, readable by every trusted
  ClickHouse user. In Go the key never leaves the process.
- **No SQL rewriting.** Widgets come from builder queries and from `.sql` files with arbitrary aliases; masking in
  SQL would need either a view per table (duplicating every table's shape) or parsing SQL. The JSON result has
  plain column names and values.
- **One place** for all tools, including alert messages, and it reuses `lib/db_sampler`'s processor model.

Cost: the result is decoded in Go (JSON, up to the row cap below), and ClickHouse still reads the raw data. Masking
inside ClickHouse would only be needed for free SQL, which MCP does not offer (§3.9).

#### 3.6.2 What: scrambled by default, marked as not secret in Go

**Every string value is scrambled unless the dashboard marks its field as not secret.** A forgotten mark scrambles
too much, it never leaks; the marks are added where the assistant needs plain values.

```go
widget.NewTimeBar(requests).
    X(sql.Timestamp15Min()).
    Y(sql.Count()).
    Fill(sql.Field("status").Public())                       // status codes: not secret

widget.NewBarVertical(sql.FromFile("errors-by-route.sql")).  // a .sql file: its columns have no Go field
    X(sql.NewFieldAlias("route").Public()).                  // the field names the alias
    Y(sql.Count())
```

For every result column:

1. **Numbers, booleans, dates and timestamps pass** (counts, durations, status codes as numbers, buckets): they are
   the measures the assistant analyses. A numeric identifier (a numeric user id) is the exception; its field gets
   `.Secret()` (open question 9).
2. **A string column whose field is marked `.Public()`** passes unchanged: the mark says the author checked it.
3. **Every other string** becomes a keyed pseudonym (§3.6.3), its class the column's alias
   (`customer_project_p0d8w1z7ra`, `client_ip_k3x9q2mfa1`). Strings that are free text (a log message) instead of an
   identifier get `.Text()`: scrubbed for patterns, not replaced as a whole.
4. Columns a widget does not declare at all (a table widget's `SELECT *`) are scrambled; `event_original`-like JSON
   blobs are scrambled as a whole, which in effect hides them.

`Public`, `Text` and `Secret` are methods on `sql.SqlField` (a flag in `fieldImpl`, serialized with the widget), so
they are written where the field is defined and reused with it (`templates.*` define most fields once for many
dashboards). The MCP server reads them from the widget's declared fields; the UI ignores them.

**Dictionaries** catch known identifiers inside free text (`.Text()` columns, alert messages): a tenant `shop-a` in
a message or in `shop-a.example.com` becomes its pseudonym. Public columns pass unchanged and scrambled ones are
replaced whole, so only free text needs them. Two sources, both fresh for every tool call, no cache and no timer
(a tenant added a minute ago must not pass in plain text):

- **The result itself:** every value of a scrambled column in the same result is also replaced where it appears in
  the result's free text. This needs no query.
- **Declared identifier columns:** the distinct values the instance names in Go
  (`anonymize.DistinctValues(alias, table, column, class)`, since Dashica knows no tables, §2.4), queried with each
  tool call whose result has free text: a `SELECT DISTINCT` over a few hundred values, milliseconds next to the
  widget's own query. A call without free text queries nothing.

#### 3.6.3 How: keyed pseudonyms, redaction, drop

- **Pseudonym:** `class + "_" + base32(HMAC-SHA256(key, class + "\x00" + value))[:10]`, e.g. `ip_k3x9q2mfa1`,
  `tenant_p0d8w1z7ra`. The same IP gives the same pseudonym in every column, every widget and every free-text
  match during the key's lifetime, so the assistant can say "`ip_k3x9q2mfa1` caused 80 % of the 500s and also
  appears in the error log". The class prefix tells the assistant what kind of value it is, and the token clearly
  is not a real IP. Without the key, a pseudonym cannot be reversed by enumerating all IPv4 addresses.
- **Key:** `HMAC-SHA256(server_secret, connection_id)`. `server_secret` comes from config / env. Stateless,
  stable for the connection's lifetime, so its purpose keeps its joins; different connections and different days are not
  linkable to each other. No mapping table is stored.
- **Redact:** fixed placeholder (`<EMAIL>`, `<SECRET>`) for values that carry no analytic value as identity
  (tokens, passwords, IBANs).
- **Drop:** the column is removed and listed in `notes` ("dropped: event_original"), so the assistant knows why it
  is missing.

Joinability vs. protection: pseudonyms keep linkage inside the data, and linkage is exactly what enables
re-identification in combination with outside knowledge (a pseudonymized user with a rare user agent at a
known time). That is accepted for `mode: rows`; `mode: aggregates` reduces it.

Reverse lookup: an operator who needs to know who `ip_k3x9q2mfa1` is can recompute it (a later
`dashica mcp reveal --subject <user> --date 2026-10-30 --class ip ip_k3x9q2mfa1` that hashes candidate
values from ClickHouse). Not in the first version.

#### 3.6.4 Free text: the scrubber and its limits

The scrubber is the existing `db_sampler` regex chain, moved and extended, with pseudonyms instead of placeholders
where joinability helps:

| Pattern | Replacement |
|---|---|
| IPv4, IPv6 (also `ip:port`) | `ip_…` pseudonym |
| email, URL-encoded email (`%40`) | `email_…` pseudonym |
| UUID, long hex ids (≥ 16 hex chars) | `id_…` pseudonym |
| JWT (`eyJ…`), `Bearer …`, `Basic …`, `password=…`, `token=…`, `api_key=…` | `<SECRET>` |
| high-entropy tokens (existing `RedactHighEntropyTokens(4.8, 12)`) | `<SECRET>` |
| IBAN, phone numbers | `<IBAN>`, `<PHONE>` |
| dictionary values (tenants, projects) | `tenant_…`, `project_…` |

URLs (`anonymize.URL()` and URLs found in text): keep scheme and path shape, pseudonymize the host if it is in a
dictionary, replace path segments that are numeric, UUID, hex or email with `:id` / the pseudonym, and keep query
parameter **names** but replace their values with `…`. `/api/orders/48211/invoice?email=a%40b.de&page=2` becomes
`/api/orders/:id/invoice?email=…&page=…`.

Limits, stated plainly: pattern scrubbing does not find personal names, street addresses, free-form customer text,
personal data inside base64 or compressed payloads, or SQL statements with literal values in error logs. It is a
safety net, not a guarantee. Therefore:

- `event_original` and request headers are scrambled as a whole (unmarked strings), never scrubbed piecewise.
- `message` is scrubbed and truncated to 300 characters.
- `mode: aggregates` returns no free text from logs at all (aggregate widgets group by dimensions such as status or
  dataset; their string dimensions still get the scrubber).

#### 3.6.5 Package layout

New package `lib/anonymize` (the reusable core, moved out of `lib/db_sampler`, which then imports it):

- `type Column struct { Name, Type string; Sensitivity Sensitivity }` with `Sensitivity` one of `Scramble`
  (default), `Public`, `Text`, `Secret`, taken from the widget's fields
- `type Dictionary` (`DistinctValues(...)`), declared by the instance
- `type Anonymizer` built per request from the key and the loaded dictionaries:
  `func (a *Anonymizer) Table(cols []Column, rows [][]any) (outRows [][]any, notes []string)`
  and `func (a *Anonymizer) Text(s string) string`.
- `db_sampler` keeps its `Processor` API for the sampling CLI and gains the keyed pseudonym as an option; its
  unkeyed scramble stays for offline samples.

#### 3.6.6 Aggregates-only mode

Aggregates only is the conservative setting for most connections: only aggregate widget types (§3.5), string columns
scrubbed, no table widgets, no alert history messages (status and timing only). A minimum group size (suppress rows
whose count is below k, k-anonymity style) would need to know which column is the count; it is listed as an open
question rather than built.

#### 3.6.7 Testing

- **Unit tests** in `lib/anonymize`: table-driven cases for each rule and pattern with realistic rows (a k8s gateway
  access row with `client_ip`, `request__uri` containing an email and an order id, a `message` with a JWT, a host
  `shop-a.example.com` with `shop-a` in the tenant dictionary). Same input and key → same pseudonym; different key →
  different pseudonym.
- **Canary test:** a fixture with known canary values (`203.0.113.77`, `canary-7f3@example.org`, a fixed JWT, the
  tenant `canarytenant`) spread over columns with and without rules and inside free text; the test runs the whole
  MCP tool pipeline (the catalog and `Run`, with a fake ClickHouse HTTP server that returns `JSONCompact`) and asserts that the
  **raw bytes of the tool response** contain none of the canaries in any encoding (plain, URL-encoded, lower/upper
  case). This is the test that guards against regressions in new widgets and new columns.
- **Review report:** a small dev command (`go run ./cmd/dashica-mcp-check`) that runs every widget of every
  page through the pipeline against a real ClickHouse (run by the maintainer) and lists string columns that had no
  rule and passed the scrubber unchanged, with a few sample values hashed. That list is what a reviewer looks at
  before granting a page to MCP users.
- **E2E in CI** (`ci/test.gitlab-ci.yml` already starts ClickHouse): one test that inserts canary rows into a test
  table, registers a test dashboard, and calls `get_widget_data` over the MCP HTTP endpoint with the SDK's client.

### 3.7 Limits

| Limit | Value (default) | Where |
|---|---|---|
| time range | ≤ `mcp.max_time_range` (168h); longer requests are refused with a clear message | `lib/mcp`, before the request |
| execution time | `max_execution_time=20` | ClickHouse setting per query |
| data read | `max_bytes_to_read=20000000000`, `read_overflow_mode=throw` | ClickHouse setting |
| result rows from ClickHouse | `max_result_rows=5000`, `result_overflow_mode=break` | ClickHouse setting |
| rows returned to the assistant | 200 (input `limit` up to 1000), `truncated: true` and `row_count` when cut | `lib/mcp` |
| string length | 300 characters per value | `lib/mcp` |
| tool result size | 64 KB; rows are cut from the end until it fits | `lib/mcp` |
| concurrency | 2 queries in flight per user | `lib/mcp` (semaphore) |

The settings go through the existing `QueryOptions.Settings` (URL parameters). `Client.Query` uses HTTP GET, which
ClickHouse runs read-only, and the first version sends no client-written SQL, so a dedicated ClickHouse user with a
`readonly=1` settings profile is not needed, since MCP sends only builder-made SQL (§3.9). The limits are generous
for widgets an engineer already runs in the browser and protect against "last 90 days of raw logs".

**Audit log:** every tool call is recorded per connection and shown in the UI (§3.10).

### 3.8 Example interaction

1. `list_dashboards` → `{"group": "Gateway", "url": "/p/k8s_gateway", "title": "K8s Gateway Access"}, …`
2. `describe_dashboard("/p/k8s_gateway")` → widgets `status_codes` (timeBar, "Requests by status"),
   `top_clients` (barHorizontal, "Top client IPs"), `5` (table, "Slow requests").
3. `get_widget_data("/p/k8s_gateway", "top_clients", time: "6h")` →
   `columns: [client_ip String, requests UInt64]`, rows `[["ip_k3x9q2mfa1", 18211], ["ip_7hd02lq9xe", 902]]`.
4. `get_widget_data(…, "5", time: "6h")` → rows with `request__uri: "/api/orders/:id/invoice?email=…"`,
   `client_ip: "ip_k3x9q2mfa1"`, `event_duration_ms: 8421`. The assistant links the slow requests to the same client.

### 3.9 Later: ad hoc queries through the builder, never free SQL (decided 2026-10-30)

MCP never takes SQL text. Ad hoc questions no widget answers go through a tool `query` whose input is a structured
query that Dashica composes with the SQL builder (`sql.New(sql.From(...), sql.Select(...), sql.Where(...),
sql.GroupBy(...))`):

```json
{ "source": "k8s_gateway_access", "groupBy": ["status", "route"], "measure": "count",
  "where": [{ "field": "status", "op": ">=", "value": 500 }], "time": "now-6h to now" }
```

- **Sources and fields come from the catalog.** A source is a base query the dashboards already use
  (`sql.New(sql.From("mv_caddy_accesslog"), sql.Where(...))` of a template, registered under a name), and the fields
  are the `SqlField`s the dashboards define on it, with their aliases and their `.Public()` / `.Text()` /
  `.Secret()` marks. The assistant can only combine what the authors defined, so every output column carries the
  same metadata as a widget's (§3.6.2), and no expression can turn a scrambled column into a plain one.
- **Measures** are the builder's (`sql.Count()`, sums and quantiles of numeric fields); **filters** are structured
  (field, operator, value), values bound as ClickHouse parameters, never put into SQL text (workbench §3.8).
- The query runs through the same `QueryHandler.Run` with the time range, the limits (§3.7) and the anonymizer as
  any widget.

What this needs beyond the first version: a name for each reusable base query (most live in `src/templates/` as
`sql.New(...)` values already), a list of the fields defined per base query (collected in the catalog while the
dashboards mount), and structured filters (workbench §3.8). Recommendation: build it after the widget tools, when
the assistant's questions show which sources it needs.

### 3.10 In the workbench: the main menu, connections and the audit log

With a login (§3.5) the workbench has a user, and a **main menu**: the user's button at the bottom of the left rail
(name and initials), opening a menu with "MCP connections…", the color scheme, "Log out". (The workbench's `ui`
host has the pieces: a rail button, a context menu, a side panel; the extension is `account`, the MCP part the
extension `mcp`.)

**Connections.** A connection is the permission for one purpose, for a while:

| Field | Example | Use |
|---|---|---|
| purpose | "Find the cause of the 502s on the gateway since 14:00" | shown to the assistant in the server instructions, and in the audit log |
| pages | `/p/k8s_gateway*`, `/p/caddy_ingress*` | narrows the user's own page access (never widens it) |
| mode | aggregates / rows | rows only if the user's role allows it (`dashica-mcp-rows`) |
| reveal | `customer_tenant` | columns shown in plain text for this connection, if the role allows it (open question 2) |
| ends | in 2 hours (choices 1h, 8h, 1 day, 7 days; at most what the role allows) | after that every call is refused |

- **Creating one** opens a form in a side panel; on "Create" it shows the connection's URL
  (`https://dashica.example/mcp/c/<id>`) and the command to copy (`claude mcp add --transport http dashica-502s
  https://dashica.example/mcp/c/<id>`). The client logs in through Keycloak (§3.5); the connection id in the URL
  narrows what that login may do: **grant = the user's Keycloak roles ∩ the connection's scope, until it ends**. A
  token of another user does not work on someone else's connection.
- **The list** shows each connection with its state: *waiting* (not used yet), *connected* (a call in the last 5
  minutes), *idle*, *ended*, *revoked*; its purpose, scope, remaining time, number of calls, last call. Buttons:
  "Audit log", "Extend", "Revoke" (takes effect on the next call).
- **Storage:** connections and the audit log live in a ClickHouse table each, in the database Dashica already
  writes its alert state to (`alert_storage`); the audit log with a TTL (open question 11). No new database.

**Audit log.** Every tool call is one row: connection, user, time, tool, its input (page, widget, time range, or the
structured query of §3.9), the SQL Dashica built, ClickHouse's summary (rows and bytes read, elapsed), rows
returned and truncated, the anonymization notes (which columns were scrambled, which were public), and **the result
as the assistant received it** (after anonymization, the first 50 rows). The UI shows it in the bottom panel "MCP
audit": a timeline of the calls (newest first, filterable by connection), each opening to its input, its SQL (as
the debug panel shows a widget's SQL) and its result as a table (the table widget). So the user sees exactly what
left Dashica, and a reviewer can check a connection afterwards. The result kept is the anonymized one; the raw data
is never stored.

## 4. Alternatives considered

| Alternative | Why rejected (for now) |
|---|---|
| **Separate MCP binary over stdio** on the developer's machine, talking to ClickHouse | needs ClickHouse credentials and the dashboard definitions on each laptop; duplicates query resolution; the anonymization key would live on clients |
| **Separate binary that calls Dashica's HTTP API** (stdio or HTTP) | needs a decoded result format over the network (Arrow decoding in Go or a public JSON endpoint) and auth between the two; adds a deployment for no gain over a handler in the same process |
| **Stateful streamable HTTP with sessions** | session state per client, sticky routing; the only state needed (pseudonym key) derives from user + date. Spec 2026-07-28 is stateless in the SDK anyway |
| **Anonymize in ClickHouse for the widget tools** (masking views, rewritten queries, row policies) | key ends up in query text / view definitions visible to all trusted users; every `.sql` file would need rewriting to read from masked views; row policies restrict rows, they do not mask columns. Only needed for free SQL, which MCP does not offer (§3.9) |
| **A central policy by column name** (one file per instance, `client_ip` → pseudonym, `status` → keep) | aliases differ between dashboards and `.sql` files, so the policy never knows all columns; it ties Dashica to the instance's tables. Marks on the fields sit where the field is defined, and scrambled-by-default makes a missing mark safe |
| **Pattern detection only** (no marks) | misses names and tenant identifiers, cannot pseudonymize consistently by meaning, cannot drop `event_original` |
| **Redaction only** (no pseudonyms) | the assistant cannot follow one client across widgets, which is the main use of reading logs |
| **Unkeyed hashing** (existing crc32 scramble, plain SHA-256) | reversible by enumerating IPv4 space or known emails and tenant names |
| **Calling the HTTP handlers in-process** (`ServeHTTP` with a recorder on `/workbench.json`, `page.json`, `<page>/api/<id>/query?format=JSON`) | a fake request and recorder per call, MCP coupled to URLs, query strings and response headers; the catalog and `Run` give the same reuse in plain Go |
| **Free SQL** (with string checks, or on masked views with a `readonly` ClickHouse user) | string checks are not a security boundary; on arbitrary SQL output the anonymization is unsound (`concat`, `hex(client_ip)` turn a scrambled column into a plain one); masked views would duplicate every table. Builder-made queries keep the field metadata (§3.9) |

## 5. Risks and migration

### 5.1 Steps (each a small, reviewable change)

1. **Refactor:** `QueryHandler.Run` from the body of `HandleQuery` / `HandleDebug` (no behaviour change; existing
   tests); the catalog filled in `RegisterDashboard` and `queryHandler`.
2. **`lib/anonymize` and the field marks:** `.Public()` / `.Text()` / `.Secret()` on `sql.SqlField`, keyed
   pseudonyms, scrubber (ported from `lib/db_sampler`, which then uses it), dictionaries; unit tests and the canary
   fixture. No MCP yet.
3. **Login:** OIDC with Keycloak for the UI (§3.5), the session cookie, the user in the workbench and its main menu
   (§3.10, without MCP yet). Useful on its own.
4. **`lib/mcp` skeleton and connections:** go-sdk dependency (check the `go` directive), `/mcp/c/<id>` behind
   `mcp.enabled`, access token check, protected resource metadata, connections (table, form, list in the main
   menu), the grant (roles ∩ connection), the audit log table; tools `list_dashboards` and `describe_dashboard` (no
   data yet).
5. **`get_widget_data`:** catalog entry, `QueryHandler.Run`, limits, anonymizer, truncation; canary test through the
   pipeline; aggregates only.
6. **Alerts:** `AlertManager.AlertDefinitions()` (new list method), `list_alerts`, `get_alert_history` with scrubbed
   messages.
7. **Audit log in the UI:** the bottom panel "MCP audit" (§3.10) with each call's input, SQL and anonymized result.
8. **Instance:** `.Public()` marks on the fields of `src/templates/`, the dictionaries in `main.go`, the Keycloak
   client and roles, MCP for a few users, aggregates only, on a few gateway pages; run the review report against
   production before widening access.
9. Later, driven by use: the reverse lookup command, the builder-made `query` tool (§3.9).

### 5.2 Risks

| Risk | Mitigation |
|---|---|
| A new dashboard column with personal data | scrambled by default unless marked `.Public()`, dictionaries for tenants, canary test, review report before granting a page; aggregates only unless the user has `dashica-mcp-rows` |
| Free text with names or customer content passes the scrubber | `event_original` dropped, `message` truncated, aggregate mode returns no log text; documented as a known limit |
| Pseudonyms plus context re-identify a person | daily key per user; aggregate mode; only pages on the allowlist |
| Assistant runs heavy queries in a loop | ClickHouse limits per query, time range cap, concurrency per user, audit log and a dashboard on `dashica.mcp` |
| Widget ids from the render-order counter change between deploys | ids are re-read via `describe_dashboard`; important widgets get `.Id(...)` |
| Coupling to handler URLs and request format during the workbench migration | one helper builds the widget request; the canary e2e test fails if the format changes |
| Access token leak | short-lived Keycloak tokens, audience check, page access per role, audit log; revoking the user in Keycloak |
| SDK churn (escape-hatch flags removed in v1.9, spec changes) | stateless mode only, few SDK features (tools, HTTP handler, bearer middleware); pin the version |
| Go version bump for the SDK | check before step 3; both repos build with the CI image's Go |

## 6. Open questions

1. **Is the MCP endpoint reachable from the outside, or only via VPN / the same ingress protection as the UI?**
   Recommendation: the same ingress as the UI; every call needs a Keycloak access token and a connection that has
   not ended.
2. **Should tenants and projects be pseudonymized by default?** They are the most useful dimension for an engineer
   and the most identifying for customers. Recommendation: yes by default (dictionary + `Pseudonym("tenant")`), with
   a connection's `reveal: [customer_tenant]` for users whose role allows it (§3.10).
3. **Key lifetime:** per connection (decided with §3.10; its id is in the URL): pseudonyms stay stable for the
   whole purpose, and two connections cannot be linked.
4. **Should the assistant be able to filter by a pseudonym** ("show me all requests of `ip_k3x9q2mfa1`")? This
   needs an in-memory reverse map (pseudonym → value, per connection, bounded LRU) and structured filters
   (workbench §3.8). Recommendation: yes, after structured filters exist; values are bound as parameters, never put
   into SQL text.
5. **Minimum group size in aggregate mode** (suppress groups with fewer than k events)? Requires widgets to mark
   their count column. Recommendation: not now; aggregate widgets group by coarse dimensions, and identifiers in
   group labels are pseudonymized anyway.
6. **Which fields get `.Public()` first?** Recommendation: the fields in `src/templates/` (gateway and ingress
   dashboards: status, method, route without ids, level, dataset), since most pages use them; run the review report
   (§3.6.7) to see what is still scrambled.
7. **Which base queries become `query` sources first** (§3.9)? Recommendation: those of `src/templates/` (gateway,
   ingress, log overview), named where they are defined.
8. **Return format for the assistant: rows as arrays with a column list, or objects per row?** Recommendation:
   arrays plus column list (about half the tokens of objects for wide tables); the SDK's structured output carries
   the same.
9. **Numbers pass by type; is that enough?** Numeric identifiers (a user id as `UInt64`) would pass. Recommendation:
   numbers pass, and the few numeric identifier fields get `.Secret()`; the review report lists numeric columns
   with many distinct values for a look.
10. **Which Keycloak version runs, and does it allow CIMD or dynamic client registration?** MCP clients need one of
    them to log in (§3.5). Recommendation: check before step 3; CIMD is experimental in Keycloak, dynamic client
    registration works in older versions.
11. **How long is the audit log kept, with the anonymized results?** Recommendation: 90 days (ClickHouse TTL), the
    results within it 30 days; long enough to review a connection, short enough not to become a second log store.
12. **Who may see whose audit log?** Recommendation: each user their own connections; a role `dashica-mcp-audit`
    sees all.
