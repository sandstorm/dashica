// Tests for the top row and the side panels' chrome (docs/2026-10-28-workbench.md §3.4, steps 8d, 9i and 9o): one top
// bar over the content only, with the tabs, "+" and the time range, no title bar, no Dashica icon and no filter funnel;
// the left rail and panel reach from the window's top to the status bar, the global "…" first in the rail, above search
// everywhere; "+" opens the start page in a new tab; search everywhere opens from its rail button, whose tooltip names
// its key; a panel shows under a header with its name in caps and "…", whose "Hide" closes it; with Explore off the
// global "…" shows "Explore" greyed (8g).
import {expect, test} from '@playwright/test';

test.beforeEach(async ({page}) => {
    await page.goto('/');
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
});

test('has the tabs, "+" and the time range in one top bar, without the Dashica icon', async ({page}) => {
    const top = page.getByTestId('wb-top-bar');
    await expect(top.getByRole('link', {name: 'Dashica'})).toHaveCount(0);
    await expect(top.getByRole('tab', {selected: true})).toHaveText('Home');
    await expect(top.getByRole('button', {name: 'New tab'})).toBeVisible();
    await expect(top.getByRole('button', {name: 'Shift back'})).toBeVisible();
    await expect(page.getByTestId('wb-tab-bar')).toHaveCount(1);
    await expect(page.locator('.d-workbench__title-bar')).toHaveCount(0);
});

test('has no filter funnel: a SQL condition is added from the filter bar’s "Add filter"', async ({page}) => {
    await page.goto(process.env.DASHICA_E2E_FILTER_PAGE || '/clickhouse/table_sizes');
    await expect(page.getByTestId('wb-top-bar').getByRole('tab', {selected: true})).toBeVisible();
    await expect(page.getByTestId('wb-top-bar').getByRole('button', {name: 'Filters'})).toHaveCount(0);
});

test('the left rail and panel reach from the top to the status bar; the top bar is only over the content', async ({page}) => {
    const box = async (locator: ReturnType<typeof page.locator>) => (await locator.boundingBox())!;
    const rail = await box(page.locator('.d-workbench__side--left .d-workbench__rail'));
    const panel = await box(page.getByTestId('wb-panel-header-dashboards'));
    const top = await box(page.getByTestId('wb-top-bar'));
    const status = await box(page.locator('.d-workbench__status-bar'));
    expect(rail.y).toBe(0);
    expect(panel.y).toBe(0);
    expect(rail.y + rail.height).toBeCloseTo(status.y, 0);
    expect(top.x).toBeGreaterThanOrEqual(panel.x + panel.width - 1);
});

test('has the global "…" first in the left rail, above search everywhere', async ({page}) => {
    const buttons = page.locator('.d-workbench__side--left .d-workbench__rail button:visible');
    await expect(buttons.nth(0)).toHaveAttribute('data-testid', 'wb-global-menu');
    await expect(buttons.nth(1)).toHaveAttribute('data-testid', 'wb-rail-button-search');
    await expect(page.getByTestId('wb-top-bar').getByTestId('wb-global-menu')).toHaveCount(0);
});

test('"+" opens the start page in a new tab', async ({page}) => {
    await page.locator('.d-home-page__dashboard').first().click();
    await expect(page).not.toHaveURL(/\/$/);
    await page.getByRole('button', {name: 'New tab'}).click();
    await expect(page.getByRole('tab')).toHaveCount(2);
    await expect(page.getByRole('tab', {selected: true})).toHaveText('Home');
    await expect(page).toHaveURL(/\/$/);
});

test('opens search everywhere from its rail button, whose tooltip names the key', async ({page}) => {
    const button = page.getByTestId('wb-rail-button-search');
    await expect(button).toHaveAttribute('title', /^Search everywhere \((⌘K|Ctrl\+K)\)$/);
    await button.click();
    await expect(page.locator('.d-workbench__quick-pick input')).toBeFocused();
});

test('shows a panel under its header in caps, whose "…" hides it', async ({page}) => {
    const header = page.getByTestId('wb-panel-header-dashboards');
    await expect(header.getByRole('heading', {name: 'Dashboards'})).toHaveCSS('text-transform', 'uppercase');
    await header.getByRole('button', {name: 'Dashboards actions'}).click();
    await page.getByRole('option', {name: 'Hide'}).click();
    await expect(header).toBeHidden();
    await expect(page.getByTestId('wb-panel-toggle-dashboards')).toHaveAttribute('aria-pressed', 'false');
});

test('the global "…" opens a menu: no field in sight, the arrow keys at once, the button pressed until it closes', async ({page}) => {
    const button = page.getByTestId('wb-global-menu');
    await button.click();
    const box = page.locator('.d-workbench__quick-pick');
    await expect(box.getByRole('option').first()).toBeVisible();
    await expect(box.locator('input')).not.toBeVisible();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(button).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await page.keyboard.press('ArrowDown');
    await expect(box.locator('[role=option][aria-selected=true]')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(box).toHaveCount(0);
    await expect(button).toHaveAttribute('aria-expanded', 'false');
});

test('with Explore off, the global "…" shows only "Explore (from scratch)", greyed, its tooltip saying why', async ({page, request}) => {
    const workbench = await (await request.get('/workbench.json')).json();
    test.skip(workbench.explore, 'Explore is on (explore_enabled)');
    await page.getByTestId('wb-global-menu').click();
    const explore = page.getByRole('option', {name: 'Explore (from scratch)'});
    await expect(explore).toHaveAttribute('aria-disabled', 'true');
    await expect(explore).toHaveAttribute('title', 'Explore is not enabled (explore_enabled)');
    await explore.click();
    await expect(page.getByRole('tab')).toHaveCount(1);
});
