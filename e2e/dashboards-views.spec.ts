// Tests for the Dashboards panel's views: a group's view closes and stays closed after a reload; favorites move by
// their grip (dragged) and with Alt+ArrowUp, and keep that order after a reload.
//
// The page defaults to the Sandstorm instance's "/clickhouse/table_sizes"; its group must hold at least two dashboards.
// Another page: DASHICA_E2E_VIEWS_PAGE.
import {expect, test, type Page} from '@playwright/test';

const PAGE = process.env.DASHICA_E2E_VIEWS_PAGE || '/clickhouse/table_sizes';

const panel = (page: Page) => page.locator('.d-dashboards-menu');
const favorites = (page: Page) => panel(page).locator('[data-view=favorites] .d-dashboards-menu__entry');
/** The titles of the favorites, without their group's name. */
const favoriteTitles = (page: Page) =>
    favorites(page).locator('a').evaluateAll((links) => links.map((link) => link.firstChild?.textContent ?? ''));

test.beforeEach(async ({page}) => {
    await page.goto(PAGE);
    await page.evaluate(() => {
        for (const key of Object.keys(localStorage)) if (key.startsWith('dashica:global:dashboards:')) localStorage.removeItem(key);
    });
    await page.reload();
});

/** The view of the group holding `PAGE`. */
const groupOfPage = (page: Page) => panel(page).locator('.d-view', {has: page.locator(`a[href="${PAGE}"]`)}).last();

test('closes a group\'s view with its header, and it stays closed after a reload', async ({page}) => {
    const header = groupOfPage(page).locator('.d-view__toggle');
    const title = await header.locator('.d-view__title').textContent();
    await expect(header).toHaveAttribute('aria-expanded', 'true');
    await header.click();
    await expect(header).toHaveAttribute('aria-expanded', 'false');
    await expect(panel(page).locator(`a[href="${PAGE}"]`)).toBeHidden();
    await page.reload();
    const again = panel(page).locator('.d-view__toggle', {hasText: title!});
    await expect(again).toHaveAttribute('aria-expanded', 'false');
    await again.focus();
    await page.keyboard.press('ArrowRight');
    await expect(again).toHaveAttribute('aria-expanded', 'true');
});

/** Stars the first two dashboards of the group holding `PAGE`; returns their titles in that order. */
async function starTwo(page: Page): Promise<string[]> {
    const entries = groupOfPage(page).locator('.d-dashboards-menu__entry');
    const titles = [await entries.nth(0).locator('a').textContent(), await entries.nth(1).locator('a').textContent()] as string[];
    for (const title of titles) {
        await groupOfPage(page).locator('.d-dashboards-menu__entry', {has: page.locator('a', {hasText: title})}).first().hover();
        await groupOfPage(page).getByRole('button', {name: `Add ${title} to the favorites`}).click();
    }
    await expect.poll(() => favoriteTitles(page)).toEqual(titles);
    return titles;
}

test('moves a favorite dragged by its grip, and keeps the order after a reload', async ({page}) => {
    const [first, second] = await starTwo(page);
    const target = favorites(page).nth(0);
    await favorites(page).nth(1).hover();
    const grip = favorites(page).nth(1).locator('.d-dashboards-menu__grip');
    const from = (await grip.boundingBox())!;
    const to = (await target.boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, to.y + 2, {steps: 5});
    await page.mouse.up();
    await expect.poll(() => favoriteTitles(page)).toEqual([second, first]);
    await page.reload();
    await expect.poll(() => favoriteTitles(page)).toEqual([second, first]);
});

test('moves a favorite with Alt+ArrowUp, the focus staying on it', async ({page}) => {
    const [first, second] = await starTwo(page);
    const link = favorites(page).nth(1).locator('a');
    await link.focus();
    await page.keyboard.press('Alt+ArrowUp');
    await expect.poll(() => favoriteTitles(page)).toEqual([second, first]);
    await expect(favorites(page).nth(0).locator('a')).toBeFocused();
});
