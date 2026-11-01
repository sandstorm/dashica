# Conventions

Rules for anyone changing Dashica's code, people and coding agents alike. `mise run quality:*` checks what it can
(`quality:typecheck`, `quality:top-comments`, `quality:css`); the rest is on you. Design decisions and their history
live in the concepts (`docs/YYYY-MM-DD-*.md`); this file holds only the rules that apply everywhere.

## Before you write

- **Least total complexity that still behaves nicely,** measured in obviousness, not lines. Every type, helper or
  contribution point of ours is a concept someone must learn: prefer the frameworks' concepts and plain code. Fewer
  technologies and libraries (no reactivity library, no Tailwind, no htmx).
- **Propose new concepts first.** A new abstraction, contribution point, endpoint or value type goes to the maintainer
  with what it replaces and what it brings, before it is built. Renames, moves and plain functions are not new
  concepts.
- **Ask before moving or folding files** across modules; report the candidates and let the maintainer decide each.
- **Deep modules:** much hidden behind a small interface. Don't split a deep class into shallow ones; no pass-through
  layers, no closure factories that only forward to one call.
- **Information hiding:** expose what callers need; no member exists only for tests or one caller.
- **Values and pure functions over gathered state:** things return what they built (`CollectHandlers` returns
  `PageJson`), derived data is a function of those values. No context objects that collect side results, no
  registries looked up by key, no getters with side effects.
- **Compute, don't copy:** one owner computes a value from its source where it is needed; never copy it into a
  context or a parameter chain to carry it along. Example: the client computes the effective time range from the URL
  and `page.json`, and every request carries it, so the server needs no page default.
- **A parser only reads its input:** defaults, policy and config checks happen where the value is used.
- **Remove what does not work** rather than polish it. No backwards compatibility, shims or migration notes: the
  workbench is young.
- **Investigate, don't guess.** Find the root cause (in our code, in the library's source); say plainly what you do
  not know.

## Where code goes (frontend)

- **Layers:** `frontend/core/` (shared basics: disposables, events, cancellation, fuzzy matching, style tokens) ←
  `frontend/hosts/<name>/` (mechanism: commands, ui, page, query, widgets, extension host) ←
  `frontend/extensions/<name>/` (features) and `frontend/workbench/` (wires hosts and extensions). Imports go down
  only; no cycles.
- **Highest layer that can hold it,** next to its consumers: extension, then host, then core. A host function only
  one extension uses moves into that extension.
- **Hosts keep only mechanism.** For each host member ask: mechanism, or one feature's policy? Policy is an extension.
  No host names an extension's key, command, header or concept (filters, alerts, a chart type).
- **Libraries:** what several extensions share lives in `frontend/extensions/<name>-library/`: stateless helpers and
  contracts, no `Extension`, no module-level state. Extensions may import a `-library` folder; hosts and their tests
  never do.
- **Extensions never depend on each other:** no imports, no shared services, no calling each other's commands. A host
  offers a generic point (a provider, a menu, a decoration); the consumer reads every contribution.
- **Generated code** (`frontend/generated/`, `zz_generated.*`) changes only by running its generator.

## Modules and files

- **A module** is `core/<name>/`, `hosts/<name>/` or `extensions/<name>/`. From outside, import its entry `<name>.ts`.
- **A host's entry is its contract:** interfaces first, the implementation in `<name>-impl.ts`, re-exported at the
  bottom.
- **About 3 source files** at a module's top level; more get subfolders named after a concept. Never `utils/`,
  `helpers/`, `shared/`, `impl/`, `services/`.
- **Files read general to specific:** the main export first, then other exports, then private helpers in order of
  use.
- **Module scope holds constants and pure functions only.** State lives in an instance with its owner's lifetime (a
  host's constructor, an extension's `activate`). Exception: a `WeakMap` memo on immutable values.

## Extension API

- **VS Code's names and shapes** where the concept matches: `activate`, `subscriptions`, `register…Provider`,
  `provide…`, `onDid<Verb>`, `executeCommand`, `show…Message`, `showQuickPick`, `showInputBox`. Object-oriented, as
  VS Code's API.
- **Register once, in `activate`;** every registration returns a `Disposable` pushed to `subscriptions`. Declarations
  (commands, query keys, menus) happen there too, never on first use. One disposal verb: `dispose()`.
- **Enablement belongs to the command,** a menu item's `when` is only its visibility.
- **Producers say what happened, extensions decide what it means:** a host offers a provider point
  (`registerDecorationProvider`, `registerDataPointMenuProvider`) and the producer (a chart, a table) only reports
  ("this answer", "these data points were clicked"); it never names a feature's command or concept.
- **Talk to the user through the `ui` host** (`showInputBox`, `showQuickPick`, `showContextMenu`), never hand-made
  popovers. Anything that waits on the server shows that it is busy; nothing fails silently.
- **Errors show where they happen:** a chart's in the chart, a request after a choice in the still-open pick or input
  box (its message line). There is no notification area.
- **State:** `globalState` / `workspaceState`, never `localStorage` directly.
- **Libraries through their documented API** (Plot's `plot.value`, `plot.scale`; htl's `html.fragment`), never their
  rendered DOM or private fields. Where only the library's source says how it behaves, the comment says so.
- **CSS:** each host and extension brings `<name>.css`; BEM classes `d-<block>__<element>--<modifier>`; colours,
  sizes and durations only from the tokens in `frontend/core/style/tokens.css`; never style another module's classes.

## Server (Go)

- **Dependency injection of what a handler needs:** long-lived services and the loaded config come through
  `rendering.Dependencies` (`deps.Config`, `deps.FilterService`); nothing request-specific goes there. Handlers check
  the config where it matters, no copied flags. A service built from the config does the config-dependent work
  itself (signing, the connection's default database) instead of callers passing secrets or lookup functions.
- **Requests carry effective values:** what the client already knows (the time range, including the page's default)
  is sent, not re-derived on the server.
- **Logic local to the widget,** decided server side: what a filter means for a chart is the chart's (its table, its
  fields, `FilterAs`), never a page-wide collection of widgets.
- **Anything from the browser that becomes SQL is signed** (`filters.secret`) or behind a feature flag
  (`filters.sqlEnabled`, `explore.enabled`).
- **No self round trip:** never fetch the app's own handler or decode JSON it just encoded; collect at the source.
- **`.sql` files and builder queries** (`sql.New`, fields) are two separate cases; never lump them together.
- **Run Go through mise:** `mise exec go -- go …`. A change to `dashica-src`'s `go.mod` or to an API the outer
  dashboards use needs `go mod tidy` and `go vet` (both build tags) in the outer repository.

## Names and types

- **Full names, never a bare postfix:** `filter.FilterService`, not `filter.Service`.
- **A field holding a service does not sound like state:** `deps.FilterService`, not `deps.Filters`.
- **DOM nodes end in `Element` or `Container`:** a field, variable, parameter or property holding one node ends in
  `Element` (`titleElement`), one that others are put into in `Container` (`badgeContainer`), several in `Elements`
  (`rowElements`); named by role (a widget renderer's `widgetContainer`, never `el`); data never does; no `$`
  prefix. A `Document` stays `doc`.
- **Names say what it does:** a function that returns what providers say is `…Of` (`decorationsOf`), one that draws
  is `draw…`.
- **Commands out, events back:** changes go in as commands or `set`, `onDid…` events come back. Nobody calls
  `refresh()` on someone else.
- **Unions discriminate on `kind`.**
- **Typed values, parsed once at the edge:** a duration is a `time.Duration`, not a string passed through handlers.
- **No `nil` for "not needed" arguments:** split the function or put it on an object that knows.
- **Product name in identifiers:** CSS classes start with `d-`, storage keys with `dashica:`.

## Comments

- **One "why" comment per concept:** the doc comment of the main element (the first export) of a module's entry
  file. First line: what it is. Then who uses it and what it guarantees, concretely. Under ~10 lines.
- **Every other file points to it:** first line `See <Name> in <path>`; a test file starts `Tests for X`. Checked by
  `quality:top-comments`.
- **API doc comments** say what a parameter or result means; never restate the code or the name. No comment is
  better than one that says nothing.
- **Say what it is, not what it is not** ("not part of the HTTP contract"): a reader cannot act on a negation.
- **No rationale, history or provenance in source comments:** no step ids (`9ad`), decision ids (`D38`), concept
  section numbers (`§3.15`), "since …", "used to …", "as VS Code / Zwiebelfisch does". That belongs in the concept
  and the commit message.
- **Examples are Dashica's** (`timeRange.refresh`, dashboards, charts, `http_logs`), never ported ones.
- **Match the surrounding code:** comment density, naming, idiom. Keep multi-line option objects (Plot options) one
  property per line.

## Tests and commits

- **Test through the exported interface.** vitest (jsdom) for core, hosts and extensions; Go tests next to the
  package; Go golden JSON for the contract. Never copy production logic into tests.
- **Agents in the sandbox** cannot launch browsers, bind ports or reach ClickHouse: write the Playwright spec and the
  ClickHouse-bound test, the maintainer runs them. Never run the build; the maintainer builds.
- **One commit per step,** all checks green; docs change in the same commit as the code.
- **Keep kinds of change apart:** comment updates and re-orderings go in their own commits (prefix `STYLE:`), never
  mixed with renames (`REFACTOR:`) or functional changes (`TASK:` / `BUGFIX:`), so the reviewer can skip the
  cosmetic ones.
- **Never commit** `package-lock.json` changes you did not intend, `.idea/`, or anything under `.npmrc`.

## Known smells

Deliberately kept for now; do not copy the pattern.

- **Extensions call each other's commands** in two places, against "extensions never depend on each other":
  `details.showRecords` (the table hands its ticked rows to Details) and `filters.addSql` (a table cell adds a SQL
  chip). The click to filter (`filters.offer`) is being replaced by the data point menu
  (`registerDataPointMenuProvider`).
