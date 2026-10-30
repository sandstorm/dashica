# MCP server with anonymization (technical concept)

Status: **draft (2026-10-30)**, for review.

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
- A first version that can be built and reviewed in a few small steps, and a clear line for what comes later
  (free SQL), and under which conditions.

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
  scrambled email keeps its length and shape. That is acceptable for schema samples, not for live query results.
- Rules match **column names**. Dashboard queries alias freely (`JSONExtractString(event_original, 'request',
  'client_ip') AS ip`), so a name-only rule misses columns; the regex layer is the safety net.

### 2.4 Data and access

- Logs: `full_logs` (`customer_tenant`, `customer_project`, `host_group`, `host_name`, `event_module`,
  `event_dataset`, `timestamp`, `message`, `level`, `event_duration_ms`, `event_original` JSON blob), plus
  materialized views like `mv_caddy_accesslog`. Most personal data sits in `event_original` and `message`.
- ClickHouse connections are configured per alias in `dashica_config*.yaml` (`clickhouse.<alias>.url/user/password/
  database`, `config.ClickHouseConfig`); one instance uses a read-only user for `default` and a writing user for
  `alert_storage`, the other one database user for both. **All authenticated ClickHouse users are trusted**,
  including reading `system.query_log` across tenants.
- Dashica itself has no user authentication: `config.AuthConfig` is marked "currently not supported"; protection
  is whatever sits in front of the deployment.
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
instance. Its tools call the existing page and widget handlers **in-process**, ask for JSON instead of Arrow, run
every result through one anonymizer and size limiter, and return the result as tool output.

```
 MCP client (Claude Code)                     Dashica binary
 ─────────────────────────                    ──────────────────────────────────────────────────────────
  POST /mcp  Authorization: Bearer …  ──►  auth (token → Grant)  ──►  mcp.Server (go-sdk, stateless)
                                                                         │ tool call
                                                                         ▼
                                            lib/mcp tools ── in-process GET ──► /workbench.json, <page>/page.json
                                                  │                         ──► <page>/api/<id>/query?format=JSON
                                                  │                               (same QueryHandler, same SQL,
                                                  │                                + MCP ClickHouse settings)
                                                  ▼
                                            lib/anonymize  (policy by column + text scrubber, keyed pseudonyms)
                                                  ▼
                                            limiter (rows, string length, result bytes) ──► tool result JSON
                                                  └──► audit log (zerolog, dataset dashica.mcp; no result data)
```

### 3.2 Transport and placement

**Streamable HTTP inside the Dashica binary**, mounted only when `mcp.enabled: true` in `dashica_config*.yaml`:

- It reuses everything that is already running: the registered pages, the ClickHouse clients and their credentials,
  the alert manager. No second deployment, no ClickHouse credentials on laptops.
- The client configures a URL and a token (`claude mcp add --transport http dashica https://dashica.example/mcp
  --header "Authorization: Bearer …"`). Clients that only speak stdio use a generic stdio-to-HTTP bridge.
- **Stateless** mode: spec 2026-07-28, no server-side session to keep, works behind any load balancer. The few
  things that need continuity across calls (the pseudonym key, §3.6) derive from the token and the day instead of
  a session.

Wiring: a new package `lib/mcp` with `func Handler(deps rendering.Dependencies, site http.Handler, cfg
config.MCPConfig, policy anonymize.Policy) http.Handler`. `DashicaImpl` gets one method, `EnableMCP(policy
anonymize.Policy) Dashica`, which the instance's `main.go` calls after registering the dashboards; it mounts the
handler at `/mcp` with the Dashica mux as `site`. The policy is Go code in the instance repo (it knows its tables).

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

- **Free SQL.** The assistant chooses among the queries the dashboard authors wrote. That keeps the anonymization
  problem bounded (known widgets, known output columns) and needs no new trust boundary in ClickHouse. §3.9 and §4
  describe when and how free SQL could come.
- **The free-SQL filter chip.** Filter buttons are Go-declared SQL and can be toggled by title; structured filters
  (workbench §3.8) can be offered once they exist, since they carry only ids and bound values.
- `/debug` (SQL text and EXPLAIN): the SQL is internal; it contains no result data but can contain literal values
  from filter buttons.
- MCP resources and prompts. Tools are what current clients use best; `page.json` could later be a resource.

### 3.4 Reusing the widget handlers

The tools call the existing HTTP handlers in-process (`site.ServeHTTP(recorder, request)` with
`httptest.NewRecorder`-style recording) instead of building a parallel query path:

- Two changes in `lib/httpserver/query_new.go`:
  1. Extract the shared first half of `HandleQuery` and `HandleDebug` into
     `func (qh QueryHandler) prepare(queryObj sql.SqlQueryable, r *http.Request) (preparedQuery, error)`
     (`preparedQuery`: SQL string, `QueryOptions`, resolved time range, bucket size). This removes the existing
     duplication and is worth doing on its own.
  2. `HandleQuery` honours an internal request context value (set only by `lib/mcp`, not a URL parameter) that
     switches `Format` to `JSONCompact` and merges the MCP ClickHouse settings (§3.7). With JSON, the
     `ensureArrowCompatible` rewrite is not needed (JSON serializes `JSON`/`Dynamic` columns natively).
- The widget's own options stay in effect (a `Table` keeps its `Limit`), page filter buttons and time handling stay
  the same, and a widget an engineer sees in the browser returns the same numbers to the assistant.
- The widget id is the `dataUrl` suffix from `page.json` (`/p/k8s_gateway/api/3` → `3`, or an author-chosen id
  like `status_codes`). Ids from the render-order counter shift when a page changes; that is fine within one
  conversation, and authors can pin important widgets with `.Id(...)`.

Trade-off: the in-process HTTP call costs a request object and a recorder per tool call, and couples MCP to the
handler URLs. In return there is no new widget interface (`Query() sql.SqlQueryable` on every widget type), no
catalog to keep in sync with `Mount`, and the workbench's request-format changes (`?time=` / `QueryState`) reach MCP
through one helper, `mcp.widgetRequest(url, id, time, buttons) *http.Request`.

### 3.5 Authentication and authorization

Dashica has no user auth today, so the MCP endpoint brings its own, as small as possible:

```yaml
mcp:
  enabled: true
  max_time_range: 168h
  tokens:
    - name: sebastian-laptop             # shows in the audit log
      sha256: "9f2c…"                    # sha256 of the token; the token itself via env or a secret
      mode: rows                         # rows | aggregates
      pages: ["/p/k8s_gateway*", "/p/caddy_ingress*", "/alerts*"]
```

- `auth.RequireBearerToken` from the SDK with a verifier that compares `sha256(token)` against the list
  (constant-time) and puts a `Grant{Name, Mode, Pages}` into the request context.
- `pages` is a glob allowlist on dashboard URLs; `list_dashboards` and `describe_dashboard` show only allowed pages,
  `get_widget_data` refuses others. Alerts are allowed by their `Group` (the `alerts.yaml` path) with the same globs.
- `mode: aggregates` limits `get_widget_data` to widgets whose type aggregates (`timeBar`, `timeLine`,
  `timeHeatmap*`, `barVertical`, `barHorizontal`, `stats`); `table` and raw-log widgets are refused (§3.6.6).
- Tokens are long random strings issued by an operator; rotation = edit the list and redeploy.

OAuth (the MCP authorization spec, with the SDK's protected-resource metadata) becomes interesting once Dashica has
real user accounts; then the `Grant` comes from the user's roles (workbench §6 "Permissions per dashboard"), and the
rest of this design stays the same.

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
inside ClickHouse remains the right tool for free SQL (§3.9).

#### 3.6.2 What: a central policy by column, plus a scrubber on every string

The instance declares one `anonymize.Policy` in Go (next to `register_*.go`), keyed by **output column name**,
because dashboards reuse the same aliases across many widgets and declaring rules per widget across 100+ dashboards
is not maintainable:

```go
policy := anonymize.Policy{
    Columns: map[string]anonymize.Rule{
        "client_ip":        anonymize.Pseudonym("ip"),
        "request__remote_ip": anonymize.Pseudonym("ip"),
        "user_id":          anonymize.Pseudonym("user"),
        "customer_tenant":  anonymize.Pseudonym("tenant"),
        "customer_project": anonymize.Pseudonym("project"),
        "host_name":        anonymize.Pseudonym("host"),
        "request__host":    anonymize.Host(),        // known tenant domains → pseudonyms, rest kept
        "request__uri":     anonymize.URL(),         // see 3.6.4
        "request__headers": anonymize.Drop(),
        "event_original":   anonymize.Drop(),
        "status":           anonymize.Keep(),
        "level":            anonymize.Keep(),
        "event_dataset":    anonymize.Keep(),
    },
    Dictionaries: []anonymize.Dictionary{           // known identifiers, replaced wherever they appear in text
        anonymize.DistinctValues("default", "full_logs", "customer_tenant", "tenant"),
        anonymize.DistinctValues("default", "full_logs", "customer_project", "project"),
    },
}
```

For every result column:

1. A rule for the column name (case-insensitive) wins.
2. Otherwise by type: numbers, booleans, dates and timestamps pass (counts, durations, status codes, buckets);
   `Enum` and `LowCardinality` strings get the text scrubber.
3. Every other string gets the **text scrubber** (§3.6.4): the default for strings is scrub. `Keep` is the explicit
   opt-out for columns known to be harmless.
4. A widget can add or override rules for its own output (`.Anonymize("ip", anonymize.Pseudonym("ip"))` on the
   widget builders) for the rare alias that the central policy cannot know. This is an escape hatch, not the main
   mechanism.

Dictionaries load the distinct values of identifier columns (tenants, projects, a few hundred values) once per hour
through the normal client and replace them wherever they appear in text: in hostnames (`shop-a.example.com`), log
messages, alert messages. This catches "customer names in hostnames" far better than any pattern.

#### 3.6.3 How: keyed pseudonyms, redaction, drop

- **Pseudonym:** `class + "_" + base32(HMAC-SHA256(key, class + "\x00" + value))[:10]`, e.g. `ip_k3x9q2mfa1`,
  `tenant_p0d8w1z7ra`. The same IP gives the same pseudonym in every column, every widget and every free-text
  match during the key's lifetime, so the assistant can say "`ip_k3x9q2mfa1` caused 80 % of the 500s and also
  appears in the error log". The class prefix tells the assistant what kind of value it is, and the token clearly
  is not a real IP. Without the key, a pseudonym cannot be reversed by enumerating all IPv4 addresses.
- **Key:** `HMAC-SHA256(server_secret, token_name + date_utc)`. `server_secret` comes from config / env. Stateless,
  stable for one day per token, so a conversation keeps its joins; different tokens and different days are not
  linkable to each other. No mapping table is stored.
- **Redact:** fixed placeholder (`<EMAIL>`, `<SECRET>`) for values that carry no analytic value as identity
  (tokens, passwords, IBANs).
- **Drop:** the column is removed and listed in `notes` ("dropped: event_original"), so the assistant knows why it
  is missing.

Joinability vs. protection: pseudonyms keep linkage inside the data, and linkage is exactly what enables
re-identification in combination with outside knowledge (a pseudonymized user with a rare user agent at a
known time). That is accepted for `mode: rows`; `mode: aggregates` reduces it.

Reverse lookup: an operator who needs to know who `ip_k3x9q2mfa1` is can recompute it (a later
`dashica mcp reveal --token sebastian-laptop --date 2026-10-30 --class ip ip_k3x9q2mfa1` that hashes candidate
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

- `event_original` and request headers are dropped by default policy, not scrubbed.
- `message` is scrubbed and truncated to 300 characters.
- `mode: aggregates` returns no free text from logs at all (aggregate widgets group by dimensions such as status or
  dataset; their string dimensions still get the scrubber).

#### 3.6.5 Package layout

New package `lib/anonymize` (the reusable core, moved out of `lib/db_sampler`, which then imports it):

- `type Policy struct { Columns map[string]Rule; Dictionaries []Dictionary }`
- `type Rule` (constructors `Keep`, `Drop`, `Redact(placeholder)`, `Pseudonym(class)`, `URL`, `Host`)
- `type Anonymizer` built per request from `Policy`, key and loaded dictionaries:
  `func (a *Anonymizer) Table(cols []Column, rows [][]any) (outCols []Column, outRows [][]any, notes []string)`
  and `func (a *Anonymizer) Text(s string) string`.
- `db_sampler` keeps its `Processor` API for the sampling CLI and gains the keyed pseudonym as an option; its
  unkeyed scramble stays for offline samples.

#### 3.6.6 Aggregates-only mode

`mode: aggregates` is the conservative setting for most tokens: only aggregate widget types (§3.5), string columns
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
  MCP tool pipeline (in-process, with a fake ClickHouse HTTP server that returns `JSONCompact`) and asserts that the
  **raw bytes of the tool response** contain none of the canaries in any encoding (plain, URL-encoded, lower/upper
  case). This is the test that guards against regressions in new widgets and new columns.
- **Policy review report:** a small dev command (`go run ./cmd/dashica-mcp-check`) that runs every widget of every
  page through the pipeline against a real ClickHouse (run by the maintainer) and lists string columns that had no
  rule and passed the scrubber unchanged, with a few sample values hashed. That list is what a reviewer looks at
  before giving a token access to a page.
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
| concurrency | 2 queries in flight per token | `lib/mcp` (semaphore) |

The settings go through the existing `QueryOptions.Settings` (URL parameters). `Client.Query` uses HTTP GET, which
ClickHouse runs read-only, and the first version sends no client-written SQL, so a dedicated ClickHouse user with a
`readonly=1` settings profile is not needed yet; it becomes required with free SQL (§3.9). The limits are generous
for widgets an engineer already runs in the browser and protect against "last 90 days of raw logs".

**Audit log:** each tool call logs one zerolog line (`event.dataset = dashica.mcp`): token name, tool, page, widget,
time range, rows returned, rows truncated, dropped columns, ClickHouse `X-ClickHouse-Summary` (read rows / bytes),
duration, error. Never result values. The logs flow into `full_logs` like Dashica's own logs, so a Dashica
dashboard can show MCP usage.

### 3.8 Example interaction

1. `list_dashboards` → `{"group": "Gateway", "url": "/p/k8s_gateway", "title": "K8s Gateway Access"}, …`
2. `describe_dashboard("/p/k8s_gateway")` → widgets `status_codes` (timeBar, "Requests by status"),
   `top_clients` (barHorizontal, "Top client IPs"), `5` (table, "Slow requests").
3. `get_widget_data("/p/k8s_gateway", "top_clients", time: "6h")` →
   `columns: [client_ip String, requests UInt64]`, rows `[["ip_k3x9q2mfa1", 18211], ["ip_7hd02lq9xe", 902]]`.
4. `get_widget_data(…, "5", time: "6h")` → rows with `request__uri: "/api/orders/:id/invoice?email=…"`,
   `client_ip: "ip_k3x9q2mfa1"`, `event_duration_ms: 8421`. The assistant links the slow requests to the same client.

### 3.9 Later: free SQL, only on masked data

Free SQL is useful (ad hoc questions no dashboard answers), but it cannot be anonymized reliably in Go: aliases,
`concat`, `substring`, `hex(client_ip)` or `groupArray` turn a protected column into an unprotected one, and
`system.query_log` returns other people's query text with literal values. Column-name rules and scrubbing on the
result are not enough. If free SQL comes, it comes like this:

- A dedicated ClickHouse user `dashica_mcp` with a `readonly=1` settings profile and **constraints** on the limits
  (§3.7) so a query cannot raise them, and `SELECT` only on a database `mcp` with views over the real tables:
  identifier columns as `sipHash64Keyed` / `cityHash64` with a key that rotates and is stored in a dictionary only
  that user can read, `event_original` and headers absent, `message` absent or as a scrubbed column computed with
  `replaceRegexpAll`. No grant on `system.*` beyond what query execution needs.
- The Go anonymizer still runs on the result (dictionary + scrubber) as a second layer.
- The tool takes SQL plus a time range and adds the time filter itself.

This is the one place where "all authenticated ClickHouse users are trusted" does not suffice: the trust concerns
people, while the MCP user's output goes to a third party. The `dashica_mcp` user is a new user; existing users keep
their rights. Recommendation: **not now**; build it only when the widget tools prove too narrow in practice, and
prefer a structured `query_table` tool first (table + group-by fields + aggregate + structured filters, composed
with `sql.New` from fields the policy knows), which keeps the column knowledge of the first version.

## 4. Alternatives considered

| Alternative | Why rejected (for now) |
|---|---|
| **Separate MCP binary over stdio** on the developer's machine, talking to ClickHouse | needs ClickHouse credentials and the dashboard definitions on each laptop; duplicates query resolution; the anonymization key would live on clients |
| **Separate binary that calls Dashica's HTTP API** (stdio or HTTP) | needs a decoded result format over the network (Arrow decoding in Go or a public JSON endpoint) and auth between the two; adds a deployment for no gain over a handler in the same process |
| **Stateful streamable HTTP with sessions** | session state per client, sticky routing; the only state needed (pseudonym key) derives from token + date. Spec 2026-07-28 is stateless in the SDK anyway |
| **Anonymize in ClickHouse for the widget tools** (masking views, rewritten queries, row policies) | key ends up in query text / view definitions visible to all trusted users; every `.sql` file would need rewriting to read from masked views; row policies restrict rows, they do not mask columns. Right for free SQL (§3.9), too much for declared widgets |
| **Declare sensitivity per widget in Go** as the main mechanism | 100+ dashboards and templates would need annotations; one forgotten widget leaks. A central policy by column name with scrub-by-default plus per-widget overrides covers the same with one file |
| **Pattern detection only** (no policy) | misses names and tenant identifiers, cannot pseudonymize consistently by meaning, cannot drop `event_original` |
| **Redaction only** (no pseudonyms) | the assistant cannot follow one client across widgets, which is the main use of reading logs |
| **Unkeyed hashing** (existing crc32 scramble, plain SHA-256) | reversible by enumerating IPv4 space or known emails and tenant names |
| **A new widget interface `Query() sql.SqlQueryable` and a catalog filled in `Mount`** instead of in-process HTTP | changes every widget type and the generator; duplicates the per-widget handler logic (table limit, alert widgets); in-process calls reuse the handlers unchanged |
| **Free SQL in the first version** with string checks (`SELECT` only, table allowlist) | string checks are not a security boundary; anonymization of arbitrary SQL output is unsound (§3.9) |

## 5. Risks and migration

### 5.1 Steps (each a small, reviewable change)

1. **Refactor:** extract `QueryHandler.prepare` from `HandleQuery` / `HandleDebug` (no behaviour change; existing
   tests). Add the internal JSON format switch and extra settings via request context.
2. **`lib/anonymize`:** policy, rules, keyed pseudonyms, scrubber (ported from `lib/db_sampler`, which then uses
   it), URL and host rules, dictionaries; unit tests and the canary fixture. No MCP yet.
3. **`lib/mcp` skeleton:** go-sdk dependency (check the `go` directive), `/mcp` handler behind `mcp.enabled`,
   token auth and `Grant`, audit log, tools `list_dashboards` and `describe_dashboard` (no data yet). Config
   struct `config.MCPConfig`.
4. **`get_widget_data`:** in-process widget call, limits, anonymizer, truncation; canary test through the pipeline;
   `mode: aggregates`.
5. **Alerts:** `AlertManager.AlertDefinitions()` (new list method), `list_alerts`, `get_alert_history` with scrubbed
   messages.
6. **Instance:** the policy in the outer repo (`mcp_policy.go`, shared by both build tags with per-tag additions),
   `mcp` block in the production config, one token with `mode: aggregates` on a few gateway pages; run the policy
   review report against production before widening access.
7. Later, driven by use: reverse lookup command, structured `query_table`, `.Anonymize` overrides on widgets,
   OAuth with Dashica user accounts, and only then free SQL on masked views (§3.9).

### 5.2 Risks

| Risk | Mitigation |
|---|---|
| A new dashboard column with personal data and no rule | scrub-by-default for strings, dictionaries for tenants, canary test, policy review report before granting a page; aggregate mode as the default token mode |
| Free text with names or customer content passes the scrubber | `event_original` dropped, `message` truncated, aggregate mode returns no log text; documented as a known limit |
| Pseudonyms plus context re-identify a person | daily key per token; aggregate mode; only pages on the allowlist |
| Assistant runs heavy queries in a loop | ClickHouse limits per query, time range cap, concurrency per token, audit log and a dashboard on `dashica.mcp` |
| Widget ids from the render-order counter change between deploys | ids are re-read via `describe_dashboard`; important widgets get `.Id(...)` |
| Coupling to handler URLs and request format during the workbench migration | one helper builds the widget request; the canary e2e test fails if the format changes |
| Token leak | hashes in config, per-token page allowlist, audit log, rotation by config change; OAuth later |
| SDK churn (escape-hatch flags removed in v1.9, spec changes) | stateless mode only, few SDK features (tools, HTTP handler, bearer middleware); pin the version |
| Go version bump for the SDK | check before step 3; both repos build with the CI image's Go |

## 6. Open questions

1. **Is the MCP endpoint reachable from the outside, or only via VPN / the same ingress protection as the UI?**
   Recommendation: same ingress as the UI plus the bearer token; do not expose `/mcp` without the token even
   internally.
2. **Should tenants and projects be pseudonymized by default?** They are the most useful dimension for an engineer
   and the most identifying for customers. Recommendation: yes by default (dictionary + `Pseudonym("tenant")`), with
   an explicit per-token `reveal: [customer_tenant]` option for internal analysis tokens.
3. **Key lifetime: per day per token, or per conversation?** A conversation id would need sessions or a client-sent
   value. Recommendation: per day per token; revisit if the MCP spec gives stateless servers a stable conversation
   id.
4. **Should the assistant be able to filter by a pseudonym** ("show me all requests of `ip_k3x9q2mfa1`")? This
   needs an in-memory reverse map (pseudonym → value, per token and day, bounded LRU) and structured filters
   (workbench §3.8). Recommendation: yes, after structured filters exist; values are bound as parameters, never put
   into SQL text.
5. **Minimum group size in aggregate mode** (suppress groups with fewer than k events)? Requires widgets to mark
   their count column. Recommendation: not now; aggregate widgets group by coarse dimensions, and identifiers in
   group labels are pseudonymized anyway.
6. **One policy per instance or per ClickHouse alias?** The two instances have different tables. Recommendation: one
   Go policy per instance (build-tag specific additions), keyed by column name; per-alias only if column names
   collide with different meanings.
7. **Does the deployed ClickHouse version offer built-in column masking** (masking policies), which would simplify
   §3.9? Recommendation: check when free SQL is actually planned; it does not affect the first version.
8. **Return format for the assistant: rows as arrays with a column list, or objects per row?** Recommendation:
   arrays plus column list (about half the tokens of objects for wide tables); the SDK's structured output carries
   the same.
