// Tests for views popped out into tabs (docs/2026-10-28-workbench.md §3.14 D14, step 8l): Details' "Pop out" opens a
// tab with the selected records side by side; Debug's opens a tab with the active chart's debug info that stays with
// that chart when another becomes active; "Open Speedscope" opens the viewer in a tab, in an iframe. A reload keeps
// none of them.
//
// The page defaults to the Sandstorm instance's "/templates/oekokiste-caddy-ingress" over the last 7 days, its table
// "20 slowest requests" and its time bar "HTTP non-2xx status by type"; Speedscope's to "/profiling/clarcert-clarmap".
// Others: DASHICA_E2E_RECORDS_PAGE, DASHICA_E2E_RECORDS_TABLE, DASHICA_E2E_RECORDS_OTHER, DASHICA_E2E_PROFILING_PAGE.
import {expect, test, type Page} from '@playwright/test';

const PAGE = process.env.DASHICA_E2E_RECORDS_PAGE || '/templates/oekokiste-caddy-ingress';
const TABLE = process.env.DASHICA_E2E_RECORDS_TABLE || '20 slowest requests';
const OTHER = process.env.DASHICA_E2E_RECORDS_OTHER || 'HTTP non-2xx status by type';
const PROFILING = process.env.DASHICA_E2E_PROFILING_PAGE || '/profiling/clarcert-clarmap';

const tabs = (page: Page) => page.getByTestId('wb-tab-bar').getByRole('tab');

/** The chart titled `title` on the shown page, scrolled into view. */
async function chart(page: Page, title: string) {
    const frame = page.locator('.d-chart-frame', {has: page.getByText(title, {exact: true})}).first();
    await frame.scrollIntoViewIfNeeded();
    return frame;
}

/** Chooses "Pop out" in the menu of the side panel `id`. */
async function popOut(page: Page, id: string) {
    await page.getByTestId(`wb-panel-header-${id}`).locator('.d-workbench__panel-actions').click();
    await page.getByRole('option', {name: 'Pop out'}).click();
}

test('Details pops out into a tab comparing the selected records side by side; a reload keeps it not', async ({page}) => {
    await page.goto(`${PAGE}?time=168h`);
    const frame = await chart(page, TABLE);
    const ticks = frame.locator('.tabulator-row input[type=checkbox]');
    await ticks.nth(0).check();
    await ticks.nth(1).check();
    await page.getByTestId('details-status').click();
    await popOut(page, 'details');

    await expect(tabs(page)).toHaveCount(2);
    await expect(tabs(page).nth(1)).toContainText(`Details: ${TABLE}`);
    await expect(page).toHaveURL(/#view=/);
    const compared = page.locator('.d-details-compare');
    await expect(compared.locator('thead th')).toHaveText(['Field', 'Record 1', 'Record 2']);

    await page.reload();
    await expect(tabs(page)).toHaveCount(1);
    await expect(page.locator('.d-details-compare')).toHaveCount(0);
});

test('Debug pops out into a tab that stays with its chart when another becomes active', async ({page}) => {
    await page.goto(`${PAGE}?time=168h`);
    const first = await chart(page, OTHER);
    await first.getByText(OTHER, {exact: true}).click();
    await page.getByTestId('debug-status').click();
    await popOut(page, 'debug');

    await expect(tabs(page)).toHaveCount(2);
    await expect(tabs(page).nth(1)).toContainText(`Debug: ${OTHER}`);
    const popped = page.locator('.d-debug-tab');
    await expect(popped.locator('.d-view__title')).toHaveText(['Query', 'Stats', 'EXPLAIN plan', 'Pipeline', 'Syntax', 'Result']);
    const query = await popped.locator('pre').first().textContent();

    await tabs(page).nth(0).click();
    const table = await chart(page, TABLE);
    await table.getByText(TABLE, {exact: true}).click();
    await tabs(page).nth(1).click();
    await expect(page.locator('.d-debug-tab pre').first()).toHaveText(query!);
});

test('"Open Speedscope" opens the viewer in a tab of the workbench, in an iframe', async ({page}) => {
    await page.goto(`${PROFILING}?time=1h`);
    await page.getByRole('link', {name: 'Open Speedscope'}).click();
    await expect(tabs(page)).toHaveCount(2);
    await expect(tabs(page).nth(1)).toContainText('Speedscope');
    await expect(page.locator('iframe.d-speedscope-tab')).toHaveAttribute('src', /\/viewer\/#profileURL=/);
});
