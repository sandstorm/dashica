// Tests for the tabs (docs/2026-10-28-workbench.md §3.4.1, step 7a): "Open in new tab" in a dashboard's menu opens a
// second tab, the address bar follows the tab shown, each tab keeps its own query state, Back after opening shows the
// tab before, × closes a tab, a reload keeps the tabs, and a background tab's auto refresh pauses until it is shown.
//
// The pages default to the Sandstorm instance's "/clickhouse/table_sizes" (the first tab) and
// "/templates/oekokiste-caddy-ingress" (opened in the second); both must be in the dashboards menu. Other pages:
// DASHICA_E2E_TABS_PAGE, DASHICA_E2E_TABS_OTHER_PAGE (its title in the menu: DASHICA_E2E_TABS_OTHER_TITLE).
import {expect, test, type Page} from '@playwright/test';

const PAGE = process.env.DASHICA_E2E_TABS_PAGE || '/clickhouse/table_sizes';
const OTHER = process.env.DASHICA_E2E_TABS_OTHER_PAGE || '/templates/oekokiste-caddy-ingress';

const tabs = (page: Page) => page.getByTestId('wb-tab-bar').getByRole('tab');

/** Opens `PAGE` at `search`, then `OTHER` in a new tab (`openOther`). */
async function openSecondTab(page: Page, search = '') {
    await page.goto(`${PAGE}${search}`);
    await openOther(page);
}

/** Opens `OTHER` in a new tab from its entry's menu in the dashboards panel, beside the one tab open. */
async function openOther(page: Page) {
    await expect(tabs(page)).toHaveCount(1);
    const entry = page.locator('.d-dashboards-menu__entry', {has: page.locator(`a[href="${OTHER}"]`)}).first();
    await entry.locator('.d-dashboards-menu__more').click();
    await page.getByRole('menuitem', {name: 'Open in new tab'}).click();
    await expect(tabs(page)).toHaveCount(2);
}

const rangeButton = (page: Page) => page.locator('button[aria-haspopup=dialog].d-segmented__item');

test('opens a dashboard in a new tab; the address bar shows the tab shown, each tab its own time range', async ({page}) => {
    await openSecondTab(page, '?time=1h');
    await expect(tabs(page).nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(new RegExp(`${OTHER}$`));
    // the second tab gets a range of its own
    await rangeButton(page).click();
    await page.getByRole('dialog').getByRole('button', {name: 'Last 6 hours', exact: true}).click();
    await expect(page).toHaveURL(new RegExp(`${OTHER}\\?time=6h$`));

    await tabs(page).nth(0).click();
    await expect(tabs(page).nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(new RegExp(`${PAGE}\\?time=1h$`));
    await expect(rangeButton(page)).toHaveText('Last 1 hour');
    await expect(page.locator('.d-workbench__tab-page:not([hidden])')).toHaveCount(1);
    // the second tab's page stays rendered in the background
    await expect(page.locator('.d-workbench__tab-page[hidden]')).toHaveCount(1);

    await tabs(page).nth(1).click();
    await expect(page).toHaveURL(new RegExp(`${OTHER}\\?time=6h$`));
    await expect(rangeButton(page)).toHaveText('Last 6 hours');
    await tabs(page).nth(0).click();
    await expect(page).toHaveURL(new RegExp(`${PAGE}\\?time=1h$`));
});

test('Back after opening a tab shows the tab before; the opened tab stays', async ({page}) => {
    await openSecondTab(page);
    await page.goBack();
    await expect(tabs(page).nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(new RegExp(`${PAGE}$`));
    await expect(tabs(page)).toHaveCount(2);
});

test('× closes a tab and shows the one shown before; the last tab has none', async ({page}) => {
    await openSecondTab(page);
    await page.getByTestId('wb-tab-bar').getByRole('button', {name: /^Close /}).nth(1).click();
    await expect(tabs(page)).toHaveCount(1);
    await expect(page).toHaveURL(new RegExp(`${PAGE}$`));
    await expect(page.getByTestId('wb-tab-bar').getByRole('button', {name: /^Close /})).toHaveCount(0);
});

test('a reload keeps the tabs and shows the tab of the address bar', async ({page}) => {
    await openSecondTab(page);
    await page.reload();
    await expect(tabs(page)).toHaveCount(2);
    await expect(tabs(page).nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(new RegExp(`${OTHER}$`));
});

test('a background tab’s auto refresh pauses, and it refreshes once when shown again', async ({page}) => {
    // the queries of the first tab's charts, by path (`/…/api/3/query`), in order
    const queried: string[] = [];
    page.on('request', (request) => {
        const path = new URL(request.url()).pathname;
        if (path.startsWith(`${PAGE}/api/`) && path.endsWith('/query')) queried.push(path);
    });
    await page.goto(`${PAGE}?refresh=5`);
    // the charts in view have queried once
    await expect.poll(() => queried.length).toBeGreaterThan(0);
    await page.waitForLoadState('networkidle');
    const drawn = new Set(queried);
    await openOther(page);
    const before = queried.length;
    await page.waitForTimeout(12_000);
    expect(queried.length).toBe(before);
    await tabs(page).nth(0).click();
    // a chart that had queried already queries again: the catch-up, not a chart reaching the viewport the first time
    await expect.poll(() => queried.slice(before).some((path) => drawn.has(path))).toBe(true);
});
