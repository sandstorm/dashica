// Tests for click to filter on bar charts (docs/2026-10-28-workbench.md §3.8, step 8c): a click on a bar offers, in the
// quick pick "Filter", "<field> = <value>" to filter by (a filter icon) and to exclude (a minus icon); choosing one adds
// the chip at once; Escape and a click elsewhere close the quick pick without a chip.
//
// The page defaults to the Sandstorm instance's "/templates/oekokiste-caddy-ingress", its bar chart "Absolute HTTP 500
// Errors per Instance" (category `instance`), over the last 7 days: it needs HTTP 500s in that range. Another page and
// chart: DASHICA_E2E_BAR_PAGE, DASHICA_E2E_BAR_CHART (the chart's title).
import {expect, test, type Page} from '@playwright/test';

const PAGE = process.env.DASHICA_E2E_BAR_PAGE || '/templates/oekokiste-caddy-ingress';
const CHART = process.env.DASHICA_E2E_BAR_CHART || 'Absolute HTTP 500 Errors per Instance';

/** Opens the page, scrolls to the chart until it has drawn its bars, and gives its first bar. */
async function firstBar(page: Page) {
    await page.goto(`${PAGE}?time=168h`);
    const frame = page.locator('.d-chart-frame', {has: page.getByText(CHART, {exact: true})}).first();
    await frame.scrollIntoViewIfNeeded();
    // a chart that filters on a click has a d-filter-on-click mark; Playwright's click moves the mouse onto the bar
    // first, so Plot points at it
    const bar = frame.locator('svg:has(.d-filter-on-click) g[aria-label="bar"] rect').first();
    await expect(bar).toBeVisible();
    return bar;
}

/** The quick pick a click on a chart opens. */
const quickPick = (page: Page) => page.getByRole('dialog', {name: 'Filter'});

test('a click on a bar offers to filter by its category or exclude it; "Filter" adds it as a chip at once', async ({page}) => {
    const bar = await firstBar(page);
    await bar.click();
    const options = quickPick(page).getByRole('option');
    // the category comes first, before a fill or facet: filter by it, then exclude it
    await expect(options.nth(0)).toHaveAccessibleName(/^Filter \S+ = .+/);
    await expect(options.nth(1)).toHaveAccessibleName(/^Exclude \S+ = .+/);
    await options.nth(0).click();
    await expect(quickPick(page)).toHaveCount(0);
    const chips = page.getByTestId('wb-filter-bar').getByTestId('filter-chip');
    await expect(chips).toHaveCount(1);
    await expect(chips.first()).toContainText('=');
    // the URL holds the pill's signed key, `<payload>.<mac>`
    await expect(page).toHaveURL(/[?&]f=[^&]+(~|%7E)[\w-]{22}(&|$)/);
});

test('"Exclude" adds the category as ≠', async ({page}) => {
    const bar = await firstBar(page);
    await bar.click();
    await quickPick(page).getByRole('option', {name: /^Exclude /}).first().click();
    const chips = page.getByTestId('wb-filter-bar').getByTestId('filter-chip');
    await expect(chips).toHaveCount(1);
    await expect(chips.first()).toContainText('≠');
});

test('typing narrows the quick pick; Escape and a click elsewhere close it without a chip; the next click offers again', async ({page}) => {
    const bar = await firstBar(page);
    await bar.click();
    await expect(quickPick(page)).toBeVisible();
    await page.keyboard.type('instance');
    await expect(quickPick(page).getByRole('option').first()).toHaveAccessibleName(/instance = /);
    await page.keyboard.press('Escape');
    await expect(quickPick(page)).toHaveCount(0);

    await bar.click();
    await expect(quickPick(page)).toBeVisible();
    // the chart's title: outside the bars and the quick pick
    await page.getByText(CHART, {exact: true}).first().click();
    await expect(quickPick(page)).toHaveCount(0);
    await expect(page.getByTestId('wb-filter-bar').getByTestId('filter-chip')).toHaveCount(0);
});
