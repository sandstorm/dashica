// Tests for the start page "/" (docs/2026-10-28-workbench.md §3.4.3): no redirect; a hint while there are no
// favorites, then every group with its dashboards; a starred dashboard shows as a tile with its group and opens from
// there; the brand "Dashica" leads back to it.
//
// The dashboard starred defaults to the Sandstorm instance's "/clickhouse/table_sizes". Another one:
// DASHICA_E2E_START_PAGE.
import {expect, test} from '@playwright/test';

const PAGE = process.env.DASHICA_E2E_START_PAGE || '/clickhouse/table_sizes';

test.beforeEach(async ({page}) => {
    await page.goto('/');
    await page.evaluate(() => {
        for (const key of Object.keys(localStorage)) if (key.startsWith('dashica:global:dashboards:')) localStorage.removeItem(key);
    });
    await page.reload();
});

test('shows a hint and every group with its dashboards at "/", the tab titled "Home"', async ({page}) => {
    await expect(page).toHaveURL(/\/$/);
    const home = page.locator('.d-home-page');
    await expect(home.locator('.d-home-page__hint')).toBeVisible();
    await expect(home.locator(`.d-home-page__dashboard[href="${PAGE}"]`)).toBeVisible();
    await expect(page.getByRole('tab', {selected: true})).toHaveText('Home');
});

test('shows a starred dashboard as a tile with its group, which opens it; the brand leads back', async ({page}) => {
    const entry = page.locator('.d-dashboards-menu__entry', {has: page.locator(`a[href="${PAGE}"]`)}).last();
    await entry.hover();
    await entry.locator('.d-dashboards-menu__star').click();
    const tile = page.locator(`.d-home-page__tile[href="${PAGE}"]`);
    await expect(tile).toBeVisible();
    await expect(tile.locator('.d-home-page__tile-group')).not.toBeEmpty();
    await expect(page.locator('.d-home-page__hint')).toHaveCount(0);
    await tile.click();
    await expect(page).toHaveURL(new RegExp(`${PAGE}$`));
    await page.locator('.d-brand').click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator(`.d-home-page__tile[href="${PAGE}"]`)).toBeVisible();
});
