// Tests for the top row and the side panels' chrome (docs/2026-10-28-workbench.md §3.4, step 8d): one top bar with the
// Dashica icon, the tabs, "+" and the time range, no title bar; "+" opens the start page in a new tab; search
// everywhere opens from its button in the left rail, whose tooltip names its key; a panel shows under a header with
// its name in caps and "…", whose "Hide" closes it.
import {expect, test} from '@playwright/test';

test.beforeEach(async ({page}) => {
    await page.goto('/');
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
});

test('has the Dashica icon, the tabs, "+" and the time range in one top bar', async ({page}) => {
    const top = page.getByTestId('wb-top-bar');
    await expect(top.getByRole('link', {name: 'Dashica'})).toBeVisible();
    await expect(top.getByRole('tab', {selected: true})).toHaveText('Home');
    await expect(top.getByRole('button', {name: 'New tab'})).toBeVisible();
    await expect(top.getByRole('button', {name: 'Shift back'})).toBeVisible();
    await expect(page.getByTestId('wb-tab-bar')).toHaveCount(1);
    await expect(page.locator('.d-workbench__title-bar')).toHaveCount(0);
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
