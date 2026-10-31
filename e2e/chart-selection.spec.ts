// Tests for the selection on the other charts and in tables (docs/2026-10-28-workbench.md §3.8, step 6.8): a click on
// a time bar offers its series in the menu "Select", a click on a table cell selects its value, and the same floating
// bar as on a bar chart filters by it; the cell's menu keeps only its SQL entries.
//
// The page defaults to the Sandstorm instance's "/templates/oekokiste-caddy-ingress" over the last 7 days, its time bar
// "HTTP non-2xx status by type" (fill `status_group`: 3xx / 4xx / 5xx) and its table "20 slowest requests"
// (column `host_name`). Another page and charts: DASHICA_E2E_SELECT_PAGE, DASHICA_E2E_SELECT_TIME_BAR,
// DASHICA_E2E_SELECT_TABLE, DASHICA_E2E_SELECT_COLUMN.
import {expect, test, type Page} from '@playwright/test';

const PAGE = process.env.DASHICA_E2E_SELECT_PAGE || '/templates/oekokiste-caddy-ingress';
const TIME_BAR = process.env.DASHICA_E2E_SELECT_TIME_BAR || 'HTTP non-2xx status by type';
const TABLE = process.env.DASHICA_E2E_SELECT_TABLE || '20 slowest requests';
const COLUMN = process.env.DASHICA_E2E_SELECT_COLUMN || 'host_name';

/** Opens the page and scrolls to the chart titled `title`. */
async function chart(page: Page, title: string) {
    await page.goto(`${PAGE}?time=168h`);
    const frame = page.locator('.d-chart-frame', {has: page.getByText(title, {exact: true})}).first();
    await frame.scrollIntoViewIfNeeded();
    return frame;
}

test('a click on a time bar offers its series; choosing it selects; "Filter by" adds it as a chip', async ({page}) => {
    const frame = await chart(page, TIME_BAR);
    const bar = frame.locator('svg:has(.d-select-on-click) g[aria-label="rect"] rect').first();
    await expect(bar).toBeVisible();
    // the drag area lies above the bars and takes the click: `force` clicks there all the same; Playwright moves the
    // mouse onto the bar first, so Plot points at it
    await bar.click({force: true});
    const choices = page.getByRole('menu', {name: 'Select'}).getByRole('menuitem');
    // the fill comes first, before any facet
    await expect(choices.first()).toHaveText(/^status_group = /);
    const value = (await choices.first().textContent())!.replace(/^status_group = /, '');
    await choices.first().click();
    const floating = page.getByRole('toolbar', {name: 'Selection'});
    await expect(floating.getByRole('button')).toHaveText(['Filter by', 'Exclude']);

    await floating.getByRole('button', {name: 'Filter by'}).click();
    const chips = page.getByTestId('wb-filter-bar').getByTestId('filter-chip');
    await expect(chips).toHaveCount(1);
    await expect(chips.first()).toContainText(value);
});

test('a click on a table cell selects its value; "Exclude" adds it as ≠; its menu keeps only the SQL entries', async ({page}) => {
    const frame = await chart(page, TABLE);
    const cell = frame.locator(`.tabulator-cell.d-table__selectable[tabulator-field="${COLUMN}"]`).first();
    await expect(cell).toBeVisible();

    // a right click shows the menu table/cell
    await cell.click({button: 'right'});
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem')).toHaveText(['Filter: Contains this value']);
    // a click outside the menu closes it
    await frame.getByText(TABLE, {exact: true}).click();
    await expect(menu).toHaveCount(0);

    await cell.click();
    const floating = page.getByRole('toolbar', {name: 'Selection'});
    await expect(floating.getByRole('button')).toHaveText(['Filter by', 'Exclude']);
    await floating.getByRole('button', {name: 'Exclude'}).click();
    const chips = page.getByTestId('wb-filter-bar').getByTestId('filter-chip');
    await expect(chips).toHaveCount(1);
    await expect(chips.first()).toContainText('≠');
    await expect(page).toHaveURL(new RegExp(`[?&]f=${COLUMN}(:|%3A)ne(:|%3A)`));
});
