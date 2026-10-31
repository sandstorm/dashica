// Tests for the Explore view (docs/2026-10-30-perspective.md §4.4): "Open in Explore view" in a chart's menu opens a
// new tab with the chart's result in Perspective (the dashboard's URL with `#explore=<id>`, docs/2026-10-28-workbench.md
// §3.4.1); "SQL" shows the chart's SQL with its placeholders and their values beside it, an edited query runs with
// them and stays over a reload until "Reset to the chart's query" (§4.7, §4.8); the link opens it, Close closes its
// tab, Back shows the dashboard's tab, a changed config is kept per chart until Reset; the global "…" menu's "Explore"
// opens a blank Explore (a connection picker, an empty editor, its query run on the connection) and "Start from
// chart…" one with a chart's SQL (§4.8, D10). All of it needs `explore.enabled` (workbench.json's `explore`), else
// every test is skipped.
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
    await page.getByRole('option', {name: 'Open in Explore view'}).click();
    const view = page.getByTestId('explore-view');
    await expect(view).toBeVisible();
    return view;
}

const tabs = (page: Page) => page.getByTestId('wb-tab-bar').getByRole('tab');

test.beforeEach(async ({request}) => {
    const workbench = await (await request.get('/workbench.json')).json();
    test.skip(!workbench.explore, 'Explore is off: set explore.enabled: true in the dashica config');
});

test('opens the chart’s result in Perspective in a new tab, the dashboard’s URL with #explore=<id>', async ({page}) => {
    const view = await openExplore(page);
    await expect(page).toHaveURL(/\?time=168h#explore=\d+$/);
    await expect(tabs(page)).toHaveCount(2);
    await expect(tabs(page).nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(tabs(page).nth(1)).toHaveText(`Explore: ${CHART}`);
    await expect(view.locator('.d-explore-view__title')).toHaveText(`Explore: ${CHART}`);
    await expect(view.locator('perspective-viewer')).toBeVisible();
    await expect(view.locator('.d-explore-view__status')).toHaveText(/^[\d,]+ rows of the chart’s result$/);
});

test('the SQL editor: the chart’s SQL as it runs, edited without its GROUP BY, Run, a reload, Reset', async ({page}) => {
    const view = await openExplore(page);
    // open from the start
    await expect(view.getByTestId('explore-view-sql')).toHaveAttribute('aria-pressed', 'true');
    const text = view.getByTestId('explore-view-sql-text');
    await expect(text).toHaveValue(/GROUP BY/);
    const sql = await text.inputValue();
    expect(sql).not.toContain('{{DASHICA_FILTERS}}');
    await expect(view.getByTestId('explore-view-parameters')).toContainText('{__from}');

    // the chart's rows, aggregated no more
    await text.fill(sql.replace(/GROUP BY[\s\S]*$/, '').replace(/SELECT[\s\S]*?FROM/, 'SELECT * FROM'));
    const ran = page.waitForRequest((request) => /\/rows\?exploreSql=.*&param___from=/.test(request.url()));
    await view.getByTestId('explore-view-run').click();
    await ran;
    await expect(page).toHaveURL(/#explore=\d+&exploreSql=.*&param___from=/);
    await expect(view.getByTestId('explore-view-edited')).toBeVisible();
    await expect(view.locator('.d-explore-view__status')).toHaveText(/^(the first )?[\d,]+ rows( \(limit\))?$/);

    await page.reload();
    await expect(view.getByTestId('explore-view-edited')).toBeVisible();
    await expect(view.getByTestId('explore-view-sql-text')).not.toHaveValue(/GROUP BY/);

    await view.getByTestId('explore-view-sql-reset').click();
    await expect(page).not.toHaveURL(/exploreSql=/);
    await expect(view.getByTestId('explore-view-edited')).toBeHidden();
    await expect(view.locator('.d-explore-view__status')).toHaveText(/rows of the chart’s result$/);
    await expect(view.getByTestId('explore-view-sql-text')).toHaveValue(/GROUP BY/);
});

test('an edited query that fails shows ClickHouse’s message, the editor keeping the text', async ({page}) => {
    const view = await openExplore(page);
    await expect(view.locator('.d-explore-view__status')).toHaveText(/rows of the chart’s result$/);
    const text = view.getByTestId('explore-view-sql-text');
    await text.fill('SELEC 1');
    await view.getByTestId('explore-view-run').click();
    await expect(view.locator('.d-explore-view__body .d-notice--error')).toContainText('Syntax error');
    await expect(text).toHaveValue('SELEC 1');
    await text.fill('INSERT INTO FUNCTION null(\'a UInt8\') VALUES (1)');
    await view.getByTestId('explore-view-run').click();
    // refused before it runs: the transport describes the text as a subquery, where an INSERT is a syntax error
    await expect(view.locator('.d-explore-view__body .d-notice--error')).toContainText(/Syntax error|READONLY/);
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

test('Close closes the Explore tab; Back shows the dashboard’s tab, the Explore tab kept', async ({page}) => {
    let view = await openExplore(page);
    await view.getByTestId('explore-view-close').click();
    await expect(view).toBeHidden();
    await expect(tabs(page)).toHaveCount(1);
    await expect(page).not.toHaveURL(/#explore=/);

    view = await openExplore(page);
    await page.goBack();
    await expect(view).toBeHidden();
    await expect(tabs(page)).toHaveCount(2);
    await expect(tabs(page).nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(page).not.toHaveURL(/#explore=/);
});

test('the Explore tab keeps a time range of its own', async ({page}) => {
    await openExplore(page);
    const refetched = page.waitForRequest((request) => /\/rows\?time=6h/.test(request.url()));
    await page.getByTestId('wb-top-bar').getByRole('button', {name: /Last 7 days/}).click();
    await page.getByRole('button', {name: 'Last 6 hours'}).click();
    await refetched;
    await expect(page).toHaveURL(/\?time=6h#explore=\d+$/);
    await tabs(page).nth(0).click();
    await expect(page).toHaveURL(/\?time=168h$/);
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

test('the global "…" menu’s "Explore" opens a blank Explore: a connection, an empty editor, its query run there', async ({page}) => {
    await page.goto('/');
    await page.getByTestId('wb-global-menu').click();
    await page.getByRole('option', {name: 'Explore', exact: true}).click();
    const view = page.getByTestId('explore-view');
    await expect(view.locator('.d-explore-view__title')).toHaveText('Explore');
    await expect(page).toHaveURL(/#explore=&connection=[^&]+$/);
    await expect(tabs(page)).toHaveCount(2);
    await expect(view.getByTestId('explore-view-sql-text')).toHaveValue('');
    await expect(view.getByTestId('explore-view-connection')).toBeVisible();

    await view.getByTestId('explore-view-sql-text').fill('SELECT number FROM system.numbers LIMIT 5');
    const ran = page.waitForRequest((request) => /\/rows\?connection=[^&]+&exploreSql=/.test(request.url()));
    await view.getByTestId('explore-view-run').click();
    await ran;
    await expect(view.locator('.d-explore-view__status')).toHaveText('5 rows');
    await page.reload();
    await expect(page.getByTestId('explore-view').getByTestId('explore-view-sql-text')).toHaveValue('SELECT number FROM system.numbers LIMIT 5');
});

test('"Start from chart…" opens a blank Explore with the picked chart’s SQL, run with its parameters', async ({page}) => {
    await page.goto(`${PAGE}?time=168h`);
    await page.getByTestId('wb-global-menu').click();
    await page.getByRole('option', {name: 'Start from chart…'}).click();
    const ran = page.waitForRequest((request) => /\/rows\?connection=[^&]+&exploreSql=.*&param___from=/.test(request.url()));
    await page.getByRole('option', {name: CHART}).first().click();
    await ran;
    const view = page.getByTestId('explore-view');
    await expect(view.locator('.d-explore-view__title')).toHaveText('Explore');
    await expect(view.getByTestId('explore-view-sql-text')).toHaveValue(/GROUP BY/);
    await expect(view.getByTestId('explore-view-parameters')).toContainText('{__from}');
    await expect(view.locator('perspective-viewer')).toBeVisible();
});
