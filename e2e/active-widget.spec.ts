// Tests for the active widget (docs/2026-10-28-workbench.md §3.4.4): a press on a chart makes it active (outlined),
// the status bar says its title, rows and time, the left side panel "Debug" shows what it queried as views and follows
// another chart pressed; the chart menu's "Debug" opens it; each tab keeps its own active widget.
//
// The page defaults to the Sandstorm instance's "/templates/oekokiste-caddy-ingress" over the last 7 days, its charts
// "HTTP non-2xx status by type" and "20 slowest requests"; the first tab of the last test shows "/clickhouse/table_sizes".
// Others: DASHICA_E2E_ACTIVE_PAGE, DASHICA_E2E_ACTIVE_FIRST, DASHICA_E2E_ACTIVE_SECOND, DASHICA_E2E_TABS_PAGE.
import {expect, test, type Page} from '@playwright/test';

const PAGE = process.env.DASHICA_E2E_ACTIVE_PAGE || '/templates/oekokiste-caddy-ingress';
const FIRST = process.env.DASHICA_E2E_ACTIVE_FIRST || 'HTTP non-2xx status by type';
const SECOND = process.env.DASHICA_E2E_ACTIVE_SECOND || '20 slowest requests';
const TAB_PAGE = process.env.DASHICA_E2E_TABS_PAGE || '/clickhouse/table_sizes';

/** The chart titled `title` on the shown page, scrolled into view. */
async function chart(page: Page, title: string) {
    const frame = page.locator('.d-chart-frame', {has: page.getByText(title, {exact: true})}).first();
    await frame.scrollIntoViewIfNeeded();
    return frame;
}

test('a press on a chart makes it active: outlined, its status in the status bar; a click there opens Debug', async ({page}) => {
    await page.goto(`${PAGE}?time=168h`);
    const status = page.getByTestId('debug-status');
    await expect(status).toHaveText('No active chart');
    const frame = await chart(page, FIRST);
    await frame.getByText(FIRST, {exact: true}).click();
    await expect(page.locator('.d-widget--active')).toHaveCount(1);
    await expect(page.locator('.d-widget--active .d-chart-frame')).toContainText(FIRST);
    await expect(status).toContainText(FIRST);
    await expect(status).toContainText(/\d+ rows? · \d+ ms/);
    // Escape keeps it
    await page.keyboard.press('Escape');
    await expect(page.locator('.d-widget--active')).toHaveCount(1);

    await status.click();
    const debug = page.locator('[data-panel=debug]');
    await expect(debug).toBeVisible();
    await expect(debug.locator('.d-debug__title')).toHaveText(FIRST);
    await expect(debug.locator('.d-view__title')).toHaveText(['Query', 'Stats', 'EXPLAIN plan', 'Pipeline', 'Syntax', 'Result']);
    await expect(debug.locator('pre').first()).toContainText('SELECT');
});

test('Debug follows the active chart; the chart menu’s "Debug" makes it active and opens the panel', async ({page}) => {
    await page.goto(`${PAGE}?time=168h`);
    await page.getByTestId('wb-panel-toggle-debug').click();
    const debug = page.locator('[data-panel=debug]');
    await expect(debug).toContainText('Click a chart to see what it queried.');

    const second = await chart(page, SECOND);
    await second.hover();
    await second.getByRole('button', {name: 'More'}).click();
    await page.getByRole('menuitem', {name: 'Debug'}).click();
    await expect(debug.locator('.d-debug__title')).toHaveText(SECOND);

    const first = await chart(page, FIRST);
    await first.getByText(FIRST, {exact: true}).click();
    await expect(debug.locator('.d-debug__title')).toHaveText(FIRST);
});

test('each tab keeps its active widget', async ({page}) => {
    await page.goto(TAB_PAGE);
    const status = page.getByTestId('debug-status');
    await expect(status).toHaveText('No active chart');
    // the page in a second tab, from its entry's menu in the dashboards panel
    const entry = page.locator('.d-dashboards-menu__entry', {has: page.locator(`a[href="${PAGE}"]`)}).first();
    await entry.locator('.d-dashboards-menu__more').click();
    await page.getByRole('menuitem', {name: 'Open in new tab'}).click();
    const tabs = page.getByTestId('wb-tab-bar').getByRole('tab');
    await expect(tabs).toHaveCount(2);
    const first = await chart(page, FIRST);
    await first.getByText(FIRST, {exact: true}).click();
    await expect(status).toContainText(FIRST);

    await tabs.nth(0).click();
    await expect(status).toHaveText('No active chart');
    await tabs.nth(1).click();
    await expect(status).toContainText(FIRST);
});
