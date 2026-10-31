// Tests for the Explore view (docs/2026-10-30-perspective.md §4.4): "Open in Explore view" in a chart's menu lays the
// chart's result in Perspective over the content (`#explore=<id>`); "Remove grouping" shows its rows without grouping
// (needs `explore.enabled`, else that test is skipped); the link opens it, Close goes back to the chart, a changed
// config is kept per chart until Reset.
//
// The page defaults to the Sandstorm instance's "/templates/oekokiste-caddy-ingress", its bar chart "Absolute HTTP 500
// Errors per Instance", over the last 7 days. Another page and chart: DASHICA_E2E_EXPLORE_PAGE,
// DASHICA_E2E_EXPLORE_CHART (the chart's title). Needs the build with public/dist/perspective.js.
import {expect, test, type Page} from '@playwright/test';

const PAGE = process.env.DASHICA_E2E_EXPLORE_PAGE || '/templates/oekokiste-caddy-ingress';
const CHART = process.env.DASHICA_E2E_EXPLORE_CHART || 'Absolute HTTP 500 Errors per Instance';

/** Opens the page, then the chart's Explore view from its menu; gives the view. */
async function openExplore(page: Page) {
    await page.goto(`${PAGE}?time=168h`);
    const frame = page.locator('.d-chart-frame', {has: page.getByText(CHART, {exact: true})}).first();
    await frame.scrollIntoViewIfNeeded();
    await frame.getByRole('button', {name: 'More'}).click();
    await page.getByRole('menuitem', {name: 'Open in Explore view'}).click();
    const view = page.getByTestId('explore-view');
    await expect(view).toBeVisible();
    return view;
}

test('opens the chart’s result in Perspective over the content, as the page’s hash', async ({page}) => {
    const view = await openExplore(page);
    await expect(page).toHaveURL(/#explore=\d+$/);
    await expect(view.locator('.d-explore-view__title')).toHaveText(`Explore: ${CHART}`);
    await expect(view.locator('perspective-viewer')).toBeVisible();
    await expect(view.locator('.d-explore-view__status')).toHaveText(/^[\d,]+ rows of the chart’s result$/);
});

test('"Remove grouping" shows the rows without grouping, and the chart’s result again', async ({page}) => {
    const view = await openExplore(page);
    const ungroup = view.getByTestId('explore-view-ungroup');
    // the toggle shows once the chart's result is in, when the server serves the rows without grouping
    await expect(view.locator('.d-explore-view__status')).toHaveText(/rows of the chart’s result$/);
    test.skip(await ungroup.isHidden(), '"Remove grouping" is hidden: set explore.enabled: true in the dashica config');
    const fetched = page.waitForRequest((request) => /\/rows\?.*grouping=none/.test(request.url()));
    await ungroup.click();
    await fetched;
    await expect(ungroup).toHaveAttribute('aria-pressed', 'true');
    await expect(view.locator('.d-explore-view__status')).toHaveText(/^(the newest )?[\d,]+ rows( \(limit\))?$/);
    await ungroup.click();
    await expect(view.locator('.d-explore-view__status')).toHaveText(/rows of the chart’s result$/);
});

test('loads Perspective only for the view', async ({page}) => {
    const requested: string[] = [];
    page.on('request', (request) => requested.push(new URL(request.url()).pathname));
    await page.goto(`${PAGE}?time=168h`);
    await expect(page.locator('.d-chart-frame').first()).toBeVisible();
    expect(requested.filter((path) => path.includes('perspective'))).toEqual([]);
});

test('a link with the hash opens the view, with the link’s time range', async ({page}) => {
    const view = await openExplore(page);
    await expect(view.locator('perspective-viewer')).toBeVisible();
    const refetched = page.waitForRequest((request) => /\/rows\?time=24h/.test(request.url()));
    await page.goto(page.url().replace('time=168h', 'time=24h'));
    await refetched;
    await expect(page).toHaveURL(/time=24h.*#explore=\d+$/);
    await expect(view.locator('perspective-viewer')).toBeVisible();
});

test('Close and Back return to the dashboard', async ({page}) => {
    let view = await openExplore(page);
    await view.getByTestId('explore-view-close').click();
    await expect(view).toBeHidden();
    await expect(page).toHaveURL(/#w=\d+$/);

    view = await openExplore(page);
    await page.goBack();
    await expect(view).toBeHidden();
});

test('keeps the config the viewer changed for the chart, until Reset', async ({page}) => {
    let view = await openExplore(page);
    const viewer = view.locator('perspective-viewer');
    await expect(viewer).toBeVisible();
    await viewer.evaluate((el: any) => el.restore({plugin: 'Datagrid'}));
    // a press in the viewer marks the change as the viewer's own; the next config update is kept
    await viewer.click({position: {x: 5, y: 5}});
    await viewer.evaluate((el: any) => el.restore({plugin: 'Datagrid', settings: true}));
    await view.getByTestId('explore-view-close').click();

    view = await openExplore(page);
    await expect.poll(() => view.locator('perspective-viewer').evaluate(async (el: any) => (await el.save()).plugin)).toBe('Datagrid');
    await view.getByTestId('explore-view-reset').click();
    await expect.poll(() => view.locator('perspective-viewer').evaluate(async (el: any) => (await el.save()).plugin)).not.toBe('Datagrid');
});
