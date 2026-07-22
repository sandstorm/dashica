// E2E suite for the Explore editor. Encodes the manual browser session of
// 2026-07-22 (docs/2026-07-21-dynamic-widget-dashboard-ui.md).
//
// Tests marked `test.fail(...)` document KNOWN BUGS (they pass while the bug
// exists and flip loudly when it is fixed — then remove the marker and keep
// the assertion). Each references the doc's findings list.
//
// Assumes: built frontend bundle, dev ClickHouse with the `mv_agent_metrics`
// table, app on http://127.0.0.1:8081 (see e2e/README.md).

import {expect, Page, test} from '@playwright/test';

const TABLE = 'mv_agent_metrics';

// ---------------------------------------------------------------------------
// helpers (selectors rely on the data-explore pane attributes + stable
// explore-* classes; if these churn, add data-testid attributes instead)
// ---------------------------------------------------------------------------

async function addWidget(page: Page, wireName: string) {
    const tree = page.locator('[data-explore="tree"]');
    await tree.locator('select').selectOption(wireName);
    await tree.getByRole('button', {name: '+ add'}).click();
}

function inspector(page: Page) {
    return page.locator('[data-explore="inspector"]');
}

function tableInput(page: Page) {
    // The query section's table input (labelled "Table").
    return inspector(page).locator('.explore-field', {hasText: 'Table'}).locator('input').first();
}

function previewCard(page: Page) {
    return page.locator('[data-explore="preview"] .explore-card').first();
}

/** Any error surface inside the preview card: the explore preview message or
 *  the chart component's own "ERROR: ..." text. */
function previewError(page: Page) {
    return previewCard(page).locator('.explore-preview-msg--error, b:has-text("ERROR")');
}

async function pickTable(page: Page, table: string) {
    await tableInput(page).fill(table);
}

test.beforeEach(async ({page}) => {
    // Fresh editor state on every navigation — the editor autosaves to localStorage.
    await page.addInitScript(() => localStorage.clear());
    await page.goto('/explore');
    await expect(page.locator('[data-explore="tree"] select')).toBeVisible();
});

// ---------------------------------------------------------------------------
// editor shell
// ---------------------------------------------------------------------------

test('editor loads: panes, drawer tabs, toolbar', async ({page}) => {
    await expect(page.locator('[data-explore="tree"]')).toBeVisible();
    await expect(page.locator('[data-explore="preview"]')).toBeVisible();
    await expect(page.locator('[data-explore="inspector"]')).toBeVisible();
    for (const tab of ['Data', 'Go code', 'JSON']) {
        await expect(page.locator('.explore-tab', {hasText: tab})).toBeVisible();
    }
    // No dashboard sidebar — Explore owns the full screen.
    await expect(page.locator('[data-explore="preview"]')).toContainText('Add a widget to start building.');
});

test('add-widget list offers chart widgets only (no parameter/container widgets)', async ({page}) => {
    const options = await page.locator('[data-explore="tree"] select option').allTextContents();
    expect(options).toContain('Time Bar');
    expect(options).toContain('Table');
    // Parameter widgets are hidden (registered/serializable, but meaningless standalone):
    expect(options).not.toContain('Text Input');
    expect(options).not.toContain('Checkbox Group');
    // Container widgets are hidden until children editing lands:
    expect(options).not.toContain('Grid');
    expect(options).not.toContain('Collapsible Group');
});

// ---------------------------------------------------------------------------
// golden path
// ---------------------------------------------------------------------------

test('golden path: add Time Bar + pick table = rendering chart', async ({page}) => {
    await addWidget(page, 'timeBar');
    // X is auto-seeded to the intent default before a table exists:
    await expect(inspector(page).locator('select', {hasText: 'Time bucket (automatic)'}).first()).toBeVisible();

    await pickTable(page, TABLE);

    // Chart renders (Observable Plot emits an <svg>), no error surface.
    await expect(previewCard(page).locator('svg').first()).toBeVisible();
    await expect(previewError(page)).toHaveCount(0);

    // State persisted.
    const stored = await page.evaluate(() => localStorage.getItem('dashica-explore-state'));
    expect(stored).toContain(TABLE);
});

// KNOWN BUG (doc §4, browser findings 2026-07-22, B1): a freshly added widget
// fires its preview before it is buildable (no table, empty autoBucket column)
// and shows a raw ClickHouse error wall instead of a friendly
// "pick a table" state.
test('B1: freshly added widget must not show a raw ClickHouse error', async ({page}) => {
    test.fail(true, 'known bug B1 — preview fires before the widget is buildable');
    await addWidget(page, 'timeBar');
    // Give the debounced preview time to fire.
    await page.waitForTimeout(1500);
    await expect(previewError(page)).toHaveCount(0);
});

// B4 (FIXED): field slots carry a role (dimension | measure) from the Go
// struct tag; the picker offers only the kinds serving that role. BarVertical's
// X is a dimension (GROUP BY), so it must not offer "Row count" (a measure).
test('B4: BarVertical X (dimension slot) must not offer "Row count"', async ({page}) => {
    await addWidget(page, 'barVertical');
    const xField = inspector(page).locator('.explore-field', {hasText: 'X'}).first();
    const kinds = await xField.locator('select').first().locator('option').allTextContents();
    expect(kinds).not.toContain('Row count');
});

// ---------------------------------------------------------------------------
// WHERE editing (the session's main pain point)
// ---------------------------------------------------------------------------

async function chartWithTable(page: Page) {
    await addWidget(page, 'timeBar');
    await pickTable(page, TABLE);
    await expect(previewCard(page).locator('svg').first()).toBeVisible();
}

// KNOWN BUG (B2): "+ WHERE" adds an EMPTY clause row and the preview fires
// immediately — the empty string serializes into `WHERE tuple() AND ...`
// (ILLEGAL_TYPE_OF_ARGUMENT). Empty/whitespace clauses must be dropped before
// the query is built (client AND server side).
test('B2: an empty WHERE row must not break the preview', async ({page}) => {
    test.fail(true, 'known bug B2 — empty WHERE clause serialized as tuple()');
    await chartWithTable(page);
    await inspector(page).getByRole('button', {name: '+ WHERE'}).click();
    await page.waitForTimeout(1500);
    await expect(previewError(page)).toHaveCount(0);
    await expect(previewCard(page).locator('svg').first()).toBeVisible();
});

// KNOWN BUG (B3): while typing a clause, every debounce tick replaces the
// chart with a full-panel raw SQL syntax error. The chart should survive;
// errors belong in a compact overlay (and/or the clause applies on Enter/blur).
test('B3: a partial WHERE clause must not replace the chart with an error wall', async ({page}) => {
    test.fail(true, 'known bug B3 — mid-typing preview replaces chart with raw error');
    await chartWithTable(page);
    await inspector(page).getByRole('button', {name: '+ WHERE'}).click();
    const where = inspector(page).locator('input[placeholder*="level"]').first();
    await where.pressSequentially('host_name = ', {delay: 30});
    await page.waitForTimeout(1500); // debounce + query
    await expect(previewCard(page).locator('svg').first()).toBeVisible();
});

test('a complete WHERE clause filters the chart without error', async ({page}) => {
    await chartWithTable(page);
    await inspector(page).getByRole('button', {name: '+ WHERE'}).click();
    const where = inspector(page).locator('input[placeholder*="level"]').first();
    await where.fill("host_name != ''");
    await expect(previewCard(page).locator('svg').first()).toBeVisible();
    await expect(previewError(page)).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// Data tab
// ---------------------------------------------------------------------------

test('Data tab shows columns with classes/help and live sample rows', async ({page}) => {
    await chartWithTable(page);
    await page.locator('.explore-tab', {hasText: 'Data'}).click();
    const drawer = page.locator('[data-explore="drawer"]');
    await expect(drawer).toContainText(`Columns · ${TABLE}`);
    await expect(drawer).toContainText('customer_tenant');
    await expect(drawer).toContainText('Sample rows');
    // Sample rows arrive via the synthetic table widget → a tabulator table.
    await expect(drawer.locator('.tabulator, table').first()).toBeVisible();
});

test('values button lists top distinct values for a categorical column', async ({page}) => {
    await chartWithTable(page);
    await page.locator('.explore-tab', {hasText: 'Data'}).click();
    const drawer = page.locator('[data-explore="drawer"]');
    // host_name is categorical → has a values button.
    const row = drawer.locator('div', {hasText: 'host_name'}).locator('button', {hasText: 'values'}).first();
    await row.click();
    // The values list shows value + count pairs (data-dependent: any non-empty list).
    await expect(drawer.getByText(/^[0-9]+$/).first()).toBeVisible();
});

// ---------------------------------------------------------------------------
// JSON tab + share link
// ---------------------------------------------------------------------------

test('JSON tab mirrors state; invalid JSON shows an error and is not applied', async ({page}) => {
    await chartWithTable(page);
    await page.locator('.explore-tab', {hasText: 'JSON'}).click();
    const ta = page.locator('.explore-json');
    await expect(ta).toBeVisible();
    expect(await ta.inputValue()).toContain(TABLE);

    await ta.fill('{"broken');
    await expect(page.locator('.explore-json__status')).toHaveClass(/is-err/);
    // Widget survives the invalid input:
    await expect(page.locator('[data-explore="tree"] .explore-tree__item')).toHaveCount(1);
});

test('share link restores the dashboard on a fresh browser state', async ({page}) => {
    await chartWithTable(page);
    const url = await page.evaluate(() => {
        const state = localStorage.getItem('dashica-explore-state')!;
        return `${location.origin}${location.pathname}#s=${btoa(unescape(encodeURIComponent(state)))}`;
    });
    // Simulate another user: cleared storage, opens the link.
    await page.evaluate(() => localStorage.clear());
    await page.goto(url);
    await expect(page.locator('[data-explore="tree"] .explore-tree__item')).toHaveCount(1);
    await expect(previewCard(page).locator('svg').first()).toBeVisible();
});
