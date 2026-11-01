// Tests for the Schema view (docs/2026-10-30-perspective.md §4.8, D11; workbench §3.15 D32): the left side panel
// "Schema" shows under "On this page" the tables the page's charts read, under "All connections" every connection of
// dashica_config; opening one shows its databases and tables, a table its columns and keys; "Refresh" in the panel's
// "…" asks the server again, "Show comments" there hides and shows the comments; the views close and stay closed. All
// of it needs `explore_enabled` (workbench.json's `explore`), else every test is skipped.
//
// The page defaults to the Sandstorm instance's "/templates/oekokiste-caddy-ingress" (its charts on "default"); another
// page: DASHICA_E2E_SCHEMA_PAGE.
import {expect, test} from '@playwright/test';

const PAGE = process.env.DASHICA_E2E_SCHEMA_PAGE || '/templates/oekokiste-caddy-ingress';

/** A widget of `page.json` as far as these tests read it. */
interface Widget {
    table?: string;
    connection?: string;
    children?: Record<string, Widget>;
}

test.beforeEach(async ({request}) => {
    const workbench = await (await request.get('/workbench.json')).json();
    test.skip(!workbench.explore, 'Explore is off: set explore_enabled: true in the dashica config');
});

test('"On this page" shows the tables the page’s charts read, a table opens to its columns and keys', async ({page}) => {
    const answered = page.waitForResponse((response) => response.url().includes('/schema.json?connection=default') && response.ok());
    await page.goto(`${PAGE}?time=1h`);
    const json = await (await page.request.get(`${PAGE}/page.json`)).json();
    const tables = new Set<string>();
    const walk = (nodes: Widget[]) => nodes.forEach((node) => (node.table && tables.add(`${node.connection}:${node.table}`), walk(Object.values(node.children ?? {}))));
    walk(json.widgets);
    await page.getByRole('toolbar', {name: 'Left panels'}).getByRole('button', {name: 'Schema'}).click();
    await answered;
    const onPage = page.locator('[data-view="page"]');
    await expect(onPage.getByTestId('schema-connection').first().locator('summary').first()).toHaveText('default');
    await expect(onPage.getByTestId('schema-table')).toHaveCount(tables.size);

    const table = onPage.getByTestId('schema-table').first();
    await table.locator('summary').click();
    await expect(table.getByRole('list', {name: 'Columns'}).getByRole('listitem').first()).toBeVisible();
    await expect(table.getByText('Engine', {exact: true})).toBeVisible();
});

test('"All connections" lists every connection; one opens to its databases; a closed view stays closed', async ({page, request}) => {
    const workbench = await (await request.get('/workbench.json')).json();
    await page.goto(`${PAGE}?time=1h`);
    await page.getByRole('toolbar', {name: 'Left panels'}).getByRole('button', {name: 'Schema'}).click();
    const all = page.locator('[data-view="all"]');
    await expect(all.getByTestId('schema-connection').locator(':scope > summary')).toHaveText(workbench.connections);
    await all.getByTestId('schema-connection').first().locator('summary').first().click();
    await expect(all.getByTestId('schema-connection').first().locator('details').first()).toBeAttached();

    await page.getByRole('button', {name: 'On this page'}).click();
    await expect(page.getByRole('button', {name: 'On this page'})).toHaveAttribute('aria-expanded', 'false');
    await page.reload();
    // the panel's views are drawn while it is hidden too
    await expect(page.locator('[data-view="page"] .d-view__toggle')).toHaveAttribute('aria-expanded', 'false');
});

test('"Show comments" in the panel’s "…" hides the comments and shows them again', async ({page}) => {
    await page.goto(`${PAGE}?time=1h`);
    await page.getByRole('toolbar', {name: 'Left panels'}).getByRole('button', {name: 'Schema'}).click();
    await expect(page.locator('.d-schema')).not.toHaveClass(/d-schema--no-comments/);
    await page.getByRole('button', {name: 'Schema actions'}).click();
    await page.getByRole('option', {name: 'Show comments'}).click();
    await expect(page.locator('.d-schema')).toHaveClass(/d-schema--no-comments/);
    await page.getByRole('button', {name: 'Schema actions'}).click();
    await page.getByRole('option', {name: 'Show comments'}).click();
    await expect(page.locator('.d-schema')).not.toHaveClass(/d-schema--no-comments/);
});

test('"Refresh" in the panel’s "…" asks the server again for the connections asked', async ({page}) => {
    await page.goto(`${PAGE}?time=1h`);
    await page.getByRole('toolbar', {name: 'Left panels'}).getByRole('button', {name: 'Schema'}).click();
    await expect(page.locator('[data-view="page"]').getByTestId('schema-table').first()).toBeAttached();

    const refreshed = page.waitForResponse((response) => response.url().includes('refresh=1'));
    await page.getByRole('button', {name: 'Schema actions'}).click();
    await page.getByRole('option', {name: 'Refresh'}).click();
    expect((await refreshed).ok()).toBe(true);
});
