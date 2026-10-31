// Tests for the selected records (docs/2026-10-28-workbench.md §3.4.5): ticking rows of a table makes it the active
// widget, the status bar says how many records are selected, a click there opens the left side panel "Details" with a
// view per record; Details keeps them when another chart becomes active; a click on a cell still offers to filter by
// its value.
//
// The page defaults to the Sandstorm instance's "/templates/oekokiste-caddy-ingress" over the last 7 days, its table
// "20 slowest requests" (column `host_name`) and its time bar "HTTP non-2xx status by type". Others:
// DASHICA_E2E_RECORDS_PAGE, DASHICA_E2E_RECORDS_TABLE, DASHICA_E2E_RECORDS_COLUMN, DASHICA_E2E_RECORDS_OTHER.
import {expect, test, type Page} from '@playwright/test';

const PAGE = process.env.DASHICA_E2E_RECORDS_PAGE || '/templates/oekokiste-caddy-ingress';
const TABLE = process.env.DASHICA_E2E_RECORDS_TABLE || '20 slowest requests';
const COLUMN = process.env.DASHICA_E2E_RECORDS_COLUMN || 'host_name';
const OTHER = process.env.DASHICA_E2E_RECORDS_OTHER || 'HTTP non-2xx status by type';

/** The chart titled `title` on the shown page, scrolled into view. */
async function chart(page: Page, title: string) {
    const frame = page.locator('.d-chart-frame', {has: page.getByText(title, {exact: true})}).first();
    await frame.scrollIntoViewIfNeeded();
    return frame;
}

test('ticked rows make the table active; the status bar counts them; Details shows a view per record', async ({page}) => {
    await page.goto(`${PAGE}?time=168h`);
    const frame = await chart(page, TABLE);
    const ticks = frame.locator('.tabulator-row input[type=checkbox]');
    const status = page.getByTestId('details-status');
    await expect(ticks.first()).toBeVisible();
    await expect(status).toBeHidden();

    await ticks.nth(0).check();
    await expect(page.locator('.d-widget--active .d-chart-frame')).toContainText(TABLE);
    await expect(status).toHaveText('1 record selected');
    await ticks.nth(1).check();
    await expect(status).toHaveText('2 records selected');
    // the details are in the side panel, not in the table
    await expect(frame.locator('.d-record-panel')).toHaveCount(0);

    await status.click();
    const details = page.locator('[data-panel=details]');
    await expect(details).toBeVisible();
    await expect(details.locator('.d-details__title')).toHaveText(TABLE);
    await expect(details.locator('.d-view__title')).toHaveText(['Record 1', 'Record 2']);
    await expect(details.locator('.d-details__key', {hasText: COLUMN})).toHaveCount(2);

    await ticks.nth(0).uncheck();
    await expect(details.locator('.d-view__title')).toHaveText(['Record 1']);
    await expect(status).toHaveText('1 record selected');
});

test('Details keeps the ticked rows when another chart becomes active; a click on a cell still offers its value', async ({page}) => {
    await page.goto(`${PAGE}?time=168h`);
    await page.getByTestId('wb-panel-toggle-details').click();
    const details = page.locator('[data-panel=details]');
    await expect(details).toContainText('Tick rows of a table to see them here.');

    const frame = await chart(page, TABLE);
    await frame.locator('.tabulator-row input[type=checkbox]').first().check();
    await expect(details.locator('.d-view__title')).toHaveText(['Record 1']);

    // the records are the table's: another active chart leaves them in Details
    const other = await chart(page, OTHER);
    await other.getByText(OTHER, {exact: true}).click();
    await expect(page.locator('.d-widget--active .d-chart-frame')).toContainText(OTHER);
    await expect(details.locator('.d-view__title')).toHaveText(['Record 1']);
    await expect(page.getByTestId('details-status')).toHaveText('1 record selected');

    // a click on a cell makes the table active again and offers to filter by the cell's value
    const table = await chart(page, TABLE);
    await table.locator(`.tabulator-cell.d-table__filterable[tabulator-field="${COLUMN}"]`).first().click();
    await expect(details.locator('.d-view__title')).toHaveText(['Record 1']);
    await expect(page.getByRole('dialog', {name: 'Filter'}).getByRole('option')).toHaveCount(2);

    // unticked: Details has none
    await page.keyboard.press('Escape');
    await table.locator('.tabulator-row input[type=checkbox]').first().uncheck();
    await expect(details).toContainText('Tick rows of a table to see them here.');
    await expect(page.getByTestId('details-status')).toBeHidden();
});
