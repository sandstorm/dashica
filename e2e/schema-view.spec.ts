// Tests for the Schema view (docs/2026-10-30-perspective.md §4.8, D11): the left side panel "Schema" lists the
// connections of dashica_config, the page's first; opening one shows its databases and tables, a table its columns and
// keys; "Refresh" in the panel's "…" asks the server again. All of it needs `explore.enabled` (workbench.json's
// `explore`), else every test is skipped.
//
// The page defaults to the Sandstorm instance's "/templates/oekokiste-caddy-ingress" (its charts on "default"); another
// page: DASHICA_E2E_SCHEMA_PAGE.
import {expect, test} from '@playwright/test';

const PAGE = process.env.DASHICA_E2E_SCHEMA_PAGE || '/templates/oekokiste-caddy-ingress';

test.beforeEach(async ({request}) => {
    const workbench = await (await request.get('/workbench.json')).json();
    test.skip(!workbench.explore, 'Explore is off: set explore.enabled: true in the dashica config');
});

test('lists the page’s connections first; a connection opens to its databases, a table to its columns and keys', async ({page}) => {
    await page.goto(`${PAGE}?time=1h`);
    await page.getByRole('toolbar', {name: 'Left panels'}).getByRole('button', {name: 'Schema'}).click();
    await expect(page.getByText('On this page')).toBeVisible();
    const connection = page.getByTestId('schema-connection').first();
    await expect(connection.locator('summary')).toHaveText('default');

    const answered = page.waitForResponse((response) => response.url().includes('/schema.json?connection=default') && response.ok());
    await connection.locator('summary').click();
    await answered;
    const table = connection.getByTestId('schema-table').first();
    await connection.locator('details > summary').first().click();
    await table.locator('summary').click();
    await expect(table.getByRole('list', {name: 'Columns'}).getByRole('listitem').first()).toBeVisible();
    await expect(table.getByText('Engine', {exact: true})).toBeVisible();
});

test('"Refresh" in the panel’s "…" asks the server again for the connections opened', async ({page}) => {
    await page.goto(`${PAGE}?time=1h`);
    await page.getByRole('toolbar', {name: 'Left panels'}).getByRole('button', {name: 'Schema'}).click();
    await page.getByTestId('schema-connection').first().locator('summary').click();
    await expect(page.getByTestId('schema-table').first()).toBeAttached();

    const refreshed = page.waitForResponse((response) => response.url().includes('refresh=1'));
    await page.getByRole('button', {name: 'Schema actions'}).click();
    await page.getByRole('option', {name: 'Refresh'}).click();
    expect((await refreshed).ok()).toBe(true);
});
