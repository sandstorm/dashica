// Tests for the flame graph widget on a Continuous Profiling page: it draws the profile inline with its top functions,
// a click on a frame zooms to it until "Reset zoom", a click on a function searches for it.
//
// The page defaults to the Sandstorm instance's "/profiling/clarcert-clarmap" over the last 7 days, its flame graph
// titled "Flame Graph"; others: DASHICA_E2E_PROFILING_PAGE, DASHICA_E2E_FLAME_GRAPH.
import {expect, test, type Page} from '@playwright/test';

const PROFILING = process.env.DASHICA_E2E_PROFILING_PAGE || '/profiling/clarcert-clarmap';
const TITLE = process.env.DASHICA_E2E_FLAME_GRAPH || 'Flame Graph';

/** The flame graph titled TITLE on the shown page, scrolled into view, once it has drawn. */
async function flameGraph(page: Page) {
    const frame = page.locator('.d-chart-frame', {has: page.getByText(TITLE, {exact: true})}).first();
    await frame.scrollIntoViewIfNeeded();
    await expect(frame.locator('.d-flame-graph__status')).toHaveText(/samples/);
    return frame;
}

test('draws the profile inline with its top functions', async ({page}) => {
    await page.goto(`${PROFILING}?time=7d`);
    const frame = await flameGraph(page);
    await expect(frame.locator('canvas.d-flame-graph__canvas')).toBeVisible();
    expect(await frame.locator('.d-flame-graph__function').count()).toBeGreaterThan(0);
});

test('zooms to a clicked frame until Reset zoom', async ({page}) => {
    await page.goto(`${PROFILING}?time=7d`);
    const frame = await flameGraph(page);
    const reset = frame.getByRole('button', {name: 'Reset zoom'});
    await expect(reset).toBeDisabled();
    // the second row: the first frame below the root, at the left edge
    await frame.locator('canvas.d-flame-graph__canvas').click({position: {x: 2, y: 18 + 9}});
    await expect(reset).toBeEnabled();
    await expect(frame.locator('.d-flame-graph__status')).toHaveText(/of all in /);
    await reset.click();
    await expect(reset).toBeDisabled();
});

test('a click on a function searches for it', async ({page}) => {
    await page.goto(`${PROFILING}?time=7d`);
    const frame = await flameGraph(page);
    const name = await frame.locator('.d-flame-graph__name').first().textContent();
    await frame.locator('.d-flame-graph__function').first().click();
    await expect(frame.getByLabel('Search frames')).toHaveValue(new RegExp(`^\\^.*\\$$`));
    await expect(frame.locator('.d-flame-graph__status')).toHaveText(/search matches \d/);
    expect(name).toBeTruthy();
});
