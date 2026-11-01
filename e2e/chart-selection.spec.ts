// Tests for click to filter on the other charts and in tables: a click on a time bar offers its series in the data
// point menu (the quick pick "Data point"), a click on a table cell its value, as on a bar chart; choosing one adds the
// chip at once; the cell's menu keeps only its SQL entries.
//
// The page defaults to the Sandstorm instance's "/templates/oekokiste-caddy-ingress" over the last 7 days, its time bar
// "HTTP non-2xx status by type" (fill `status_group`: 3xx / 4xx / 5xx) and its table "20 slowest requests" (column
// `host_name`). Another page and charts: DASHICA_E2E_SELECT_PAGE, DASHICA_E2E_SELECT_TIME_BAR,
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

test('a click on a time bar offers its series; "Filter" adds it as a chip', async ({page}) => {
    const frame = await chart(page, TIME_BAR);
    const bar = frame.locator('svg:has(.d-filter-on-click) g[aria-label="rect"] rect').first();
    await expect(bar).toBeVisible();
    // the drag area lies above the bars and takes the click: `force` clicks there all the same; Playwright moves the
    // mouse onto the bar first, so Plot points at it
    await bar.click({force: true});
    const options = page.getByRole('dialog', {name: 'Data point'}).getByRole('option');
    // the fill comes first, before any facet
    await expect(options.first()).toHaveAccessibleName(/^Filter status_group = /);
    const value = (await options.first().textContent())!.trim().replace(/^status_group = /, '');
    await options.first().click();
    const chips = page.getByTestId('wb-filter-bar').getByTestId('filter-chip');
    await expect(chips).toHaveCount(1);
    await expect(chips.first()).toContainText(value);
});

test('a click on a table cell offers its value; "Exclude" adds it as ≠; its menu keeps only the SQL entries', async ({page}) => {
    const frame = await chart(page, TABLE);
    const cell = frame.locator(`.tabulator-cell.d-table__filterable[tabulator-field="${COLUMN}"]`).first();
    await expect(cell).toBeVisible();

    await cell.click({button: 'right'});
    const menu = page.getByRole('dialog', {name: 'table'});
    await expect(menu.getByRole('option')).toHaveText(['Filter: Contains this value']);
    await frame.getByText(TABLE, {exact: true}).click();
    await expect(menu).toHaveCount(0);

    await cell.click();
    const options = page.getByRole('dialog', {name: 'Data point'}).getByRole('option');
    await expect(options).toHaveCount(2);
    await options.nth(1).click();
    const chips = page.getByTestId('wb-filter-bar').getByTestId('filter-chip');
    await expect(chips).toHaveCount(1);
    await expect(chips.first()).toContainText('≠');
    // the URL holds the pill's signed key, `<payload>.<mac>`
    await expect(page).toHaveURL(/[?&]f=[^&]+(~|%7E)[\w-]{22}(&|$)/);
});
