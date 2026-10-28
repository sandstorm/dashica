# E2E tests (Playwright)

Browser tests for the workbench flows (`docs/2026-10-28-workbench.md` §3.10): written by the agent, run by the
maintainer (the sandbox cannot launch browsers).

## One-time setup

```bash
npm install
npx playwright install chromium
```

## Running

The suite does NOT start anything itself. Prerequisites:

1. dev ClickHouse with sample data (`docker compose -f docker-compose.dev.yml up -d`),
2. built frontend bundle (`npm run build`),
3. the app running (e.g. `mise r watch`) on `http://127.0.0.1:8081` (override with `DASHICA_E2E_BASE_URL`).

```bash
npm run e2e          # headless
npm run e2e:ui       # interactive UI mode
```

## Conventions

- Selectors use `data-testid`.
- The suite runs serially (`workers: 1`): the app is shared state.
