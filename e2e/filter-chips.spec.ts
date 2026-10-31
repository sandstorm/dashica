// Tests for the filter bar's chips (docs/2026-10-28-workbench.md §3.8, steps 6.5 and 7b): a link's `f` and `sql` show
// as chips in their order, a chart whose query ignores a structured one says so, the funnel adds a SQL chip, a chip's
// × removes it from the URL, a filter button toggles its chip.
//
// The page defaults to the Sandstorm instance's "/clickhouse/table_sizes": its tables use `FromFileWithoutFilters`,
// so every chart ignores every structured filter. Another page: DASHICA_E2E_FILTER_PAGE. The filter button test runs
// on "/p_wetell/app" (its button "Errors only"); another page and button: DASHICA_E2E_BUTTON_PAGE,
// DASHICA_E2E_BUTTON.
import {expect, test} from '@playwright/test';

const PAGE = process.env.DASHICA_E2E_FILTER_PAGE || '/clickhouse/table_sizes';
const BUTTON_PAGE = process.env.DASHICA_E2E_BUTTON_PAGE || '/p_wetell/app';
const BUTTON = process.env.DASHICA_E2E_BUTTON || 'Errors only';

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

test('a link with two `sql` shows two SQL chips; the funnel adds one; × removes one', async ({page}) => {
    await page.goto(`${PAGE}?sql=${encodeURIComponent('1 = 1')}&f=database:eq:system&sql=${encodeURIComponent('2 = 2')}`);
    const chips = page.getByTestId('wb-filter-bar').getByTestId('filter-chip');
    await expect(chips).toHaveCount(3);
    await expect(chips.nth(0)).toHaveText(/SQL:\s*1 = 1/);
    await expect(chips.nth(1)).toContainText('database');
    await expect(chips.nth(2)).toHaveText(/SQL:\s*2 = 2/);

    await page.getByRole('button', {name: 'Filters'}).click();
    const field = page.getByRole('textbox', {name: 'SQL filter'});
    await expect(field).toBeFocused();
    await field.fill('3 = 3');
    await field.press('Enter');
    await expect(chips).toHaveCount(4);
    await expect(page).toHaveURL(/sql=3(\+|%20)%3D(\+|%20)3/);

    await chips.nth(0).getByRole('button', {name: 'Remove 1 = 1'}).click();
    await expect(chips).toHaveCount(3);
    await expect(page).not.toHaveURL(/sql=1(\+|%20)%3D/);
});

test('a SQL chip is edited in place', async ({page}) => {
    await page.goto(`${PAGE}?sql=${encodeURIComponent('1 = 1')}`);
    const chips = page.getByTestId('wb-filter-bar').getByTestId('filter-chip');
    await chips.first().locator('.d-filter-chip__value').click();
    const field = page.getByRole('textbox', {name: 'SQL filter'});
    await field.fill('1 = 2');
    await field.press('Enter');
    await expect(chips.first()).toHaveText(/SQL:\s*1 = 2/);
    await expect(page).toHaveURL(/sql=1(\+|%20)%3D(\+|%20)2/);
});

test('a filter button toggles its chip, labelled with its title', async ({page}) => {
    await page.goto(BUTTON_PAGE);
    const button = page.getByTestId('wb-filter-bar').getByRole('button', {name: BUTTON, exact: true});
    const chips = page.getByTestId('wb-filter-bar').getByTestId('filter-chip');
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(chips).toHaveCount(1);
    await expect(chips.first()).toContainText(BUTTON);
    await expect(page).toHaveURL(/[?&]sql=/);

    await page.reload();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await button.click();
    await expect(chips).toHaveCount(0);
    await expect(page).not.toHaveURL(/[?&]sql=/);
});
