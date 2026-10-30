// Tests for the selection on bar charts (docs/2026-10-28-workbench.md §3.8, steps 6.7 and 6.8): a click on a bar
// offers its category in a menu "Select"; choosing it selects it, the floating bar next to it
// offers "Filter by" / "Exclude", which add a chip and end the selection; Escape and a click elsewhere end it as well.
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
    // a chart that selects has a d-select-on-click mark; Playwright's click moves the mouse onto the bar first, so Plot points at it
    const bar = frame.locator('svg:has(.d-select-on-click) g[aria-label="bar"] rect').first();
    await expect(bar).toBeVisible();
    return bar;
}

/** Clicks `bar` and chooses its category (`instance = …`) in the menu "Select". */
async function select(page: Page, bar: Awaited<ReturnType<typeof firstBar>>) {
    await bar.click();
    // the category comes first, before a fill or facet
    const choices = page.getByRole('menu', {name: 'Select'}).getByRole('menuitem');
    await expect(choices.first()).toHaveText(/^\S+ = .+/);
    await choices.first().click();
    await expect(page.getByRole('menu', {name: 'Select'})).toHaveCount(0);
}

test('a click on a bar offers its category; choosing it selects; "Filter by" in the floating bar adds it as a chip', async ({page}) => {
    const bar = await firstBar(page);
    await select(page, bar);
    const floating = page.getByRole('toolbar', {name: 'Selection'});
    await expect(floating).toBeVisible();
    await expect(floating.getByRole('button')).toHaveText(['Filter by', 'Exclude']);

    await floating.getByRole('button', {name: 'Filter by'}).click();
    await expect(floating).toBeHidden();
    const chips = page.getByTestId('wb-filter-bar').getByTestId('filter-chip');
    await expect(chips).toHaveCount(1);
    await expect(chips.first()).toContainText('=');
    await expect(page).toHaveURL(/[?&]f=[^&]+(:|%3A)eq(:|%3A)/);
});

test('"Exclude" adds the category as ≠', async ({page}) => {
    const bar = await firstBar(page);
    await select(page, bar);
    await page.getByRole('toolbar', {name: 'Selection'}).getByRole('button', {name: 'Exclude'}).click();
    const chips = page.getByTestId('wb-filter-bar').getByTestId('filter-chip');
    await expect(chips).toHaveCount(1);
    await expect(chips.first()).toContainText('≠');
});

test('Escape and a click elsewhere end the selection; the next click on a bar offers it again', async ({page}) => {
    const bar = await firstBar(page);
    const floating = page.getByRole('toolbar', {name: 'Selection'});
    await select(page, bar);
    await expect(floating).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(floating).toBeHidden();

    await select(page, bar);
    await expect(floating).toBeVisible();
    // the chart's title: outside the bars and the floating bar
    await page.getByText(CHART, {exact: true}).first().click();
    await expect(floating).toBeHidden();
    await expect(page.getByTestId('wb-filter-bar').getByTestId('filter-chip')).toHaveCount(0);
});

test('Escape closes the menu "Select" without selecting', async ({page}) => {
    const bar = await firstBar(page);
    await bar.click();
    const menu = page.getByRole('menu', {name: 'Select'});
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(page.getByRole('toolbar', {name: 'Selection'})).toBeHidden();
});
