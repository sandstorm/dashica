// Tests for the structured filters' chips (docs/2026-10-28-workbench.md §3.8, step 6.5): a link's `f` shows as a chip
// in the filter bar, a chart whose query ignores it says so, and the chip's × removes it from the URL.
//
// The page defaults to the Sandstorm instance's "/clickhouse/table_sizes": its tables use `FromFileWithoutFilters`,
// so every chart ignores every structured filter. Another page: DASHICA_E2E_FILTER_PAGE.
import {expect, test} from '@playwright/test';

const PAGE = process.env.DASHICA_E2E_FILTER_PAGE || '/clickhouse/table_sizes';

test('a link’s filter shows as a chip, the charts name it as ignored, its × removes it', async ({page}) => {
    await page.goto(`${PAGE}?f=database:eq:system`);
    const chips = page.getByTestId('wb-filter-bar').getByTestId('filter-chip');
    await expect(chips).toHaveCount(1);
    await expect(chips.first()).toContainText('database');
    await expect(chips.first()).toContainText('=');
    await expect(chips.first()).toContainText('system');

    const ignored = page.getByTestId('chart-ignored-filters').first();
    await expect(ignored).toBeVisible();
    await expect(ignored).toHaveText('ignores database');

    await chips.first().getByRole('button', {name: 'Remove database = system'}).click();
    await expect(chips).toHaveCount(0);
    await expect(page).not.toHaveURL(/[?&]f=/);
    await expect(ignored).toBeHidden();
});

test('an exclude shows ≠; back brings a removed chip back', async ({page}) => {
    await page.goto(`${PAGE}?f=database:ne:system&f=table:eq:a:b`);
    const chips = page.getByTestId('wb-filter-bar').getByTestId('filter-chip');
    await expect(chips).toHaveCount(2);
    await expect(chips.nth(0)).toContainText('≠');
    // the value is everything after the second colon
    await expect(chips.nth(1)).toContainText('a:b');

    await chips.nth(0).getByRole('button', {name: 'Remove database ≠ system'}).click();
    await expect(chips).toHaveCount(1);
    await page.goBack();
    await expect(chips).toHaveCount(2);
    await expect(page).toHaveURL(/f=database(:|%3A)ne(:|%3A)system/);
});
