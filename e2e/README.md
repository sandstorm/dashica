# Explore E2E tests (Playwright)

Browser tests for the Explore editor
(`docs/2026-07-21-dynamic-widget-dashboard-ui.md`, §4 Step 1).

## One-time setup

```bash
npm install                     # @playwright/test is a devDependency
npx playwright install chromium
```

## Running

The suite does NOT start anything itself. Prerequisites:

1. dev ClickHouse with sample data (`docker compose -f docker-compose.dev.yml up -d`
   or the project's usual dev setup — the tests query `mv_agent_metrics`),
2. built frontend bundle (`npm run build`),
3. the app running (e.g. `mise r watch`), serving `/explore` on
   `http://127.0.0.1:8081` (override with `DASHICA_E2E_BASE_URL`).

```bash
npm run e2e          # headless
npm run e2e:ui       # interactive UI mode
```

## Conventions

- Tests marked `test.fail(true, 'known bug …')` document open bugs (B1, B2, …
  — see the findings list in the design doc). They pass while the bug exists;
  once the bug is fixed they flip to "passed unexpectedly" — then delete the
  marker and keep the assertion as a regression test.
- Selectors use the `data-explore="…"` pane attributes and stable `explore-*`
  classes. If a selector churns twice, add a `data-testid` instead.
- The suite runs serially (`workers: 1`) — the editor persists to
  `localStorage` and every test clears it on navigation.
