// Tests for the filter bar's chips (docs/2026-10-28-workbench.md §3.8, steps 6.5, 7b, 8e, 8f and 9b): a link's `f` and
// `sql` show as chips in their order, a chart whose query ignores a pill says so, an unsigned pill fails the charts,
// the funnel adds a SQL chip, a chip's × removes it from the URL, a filter button toggles in place as a signed pill,
// without a chip; a button with `...` asks its value, shows it beside it and takes a new one in its place.
//
// The page defaults to the Sandstorm instance's "/clickhouse/table_sizes": its tables use `FromFileWithoutFilters`,
// so every chart ignores every pill. Another page: DASHICA_E2E_FILTER_PAGE. The pills are signed by a chart of
// "/templates/oekokiste-caddy-ingress" (another: DASHICA_E2E_PILL_PAGE). The filter button test runs
// on "/p_wetell/app" (its buttons "Errors only" and, with `...`, "Path Prefix"); another page and buttons:
// DASHICA_E2E_BUTTON_PAGE, DASHICA_E2E_BUTTON, DASHICA_E2E_VALUE_BUTTON.
import {expect, test, type Page} from '@playwright/test';

const PAGE = process.env.DASHICA_E2E_FILTER_PAGE || '/clickhouse/table_sizes';
const PILL_PAGE = process.env.DASHICA_E2E_PILL_PAGE || '/templates/oekokiste-caddy-ingress';
const BUTTON_PAGE = process.env.DASHICA_E2E_BUTTON_PAGE || '/p_wetell/app';
const BUTTON = process.env.DASHICA_E2E_BUTTON || 'Errors only';
const VALUE_BUTTON = process.env.DASHICA_E2E_VALUE_BUTTON || 'Path Prefix';

/** A widget of `page.json` as far as these tests read it. */
interface Node {
    dataUrl?: string;
    filterable?: string[];
    children?: Record<string, Node>;
}

/** The first widget of `nodes` (and their children) that can filter, depth first. */
function firstFilterable(nodes: Node[]): Node | undefined {
    for (const node of nodes) {
        if (node.dataUrl && node.filterable?.length) return node;
        const inner = firstFilterable(Object.values(node.children ?? {}));
        if (inner) return inner;
    }
    return undefined;
}

/** A pill the server signs: one of PILL_PAGE's charts' `/pill` for its first filterable field `op` `value`. */
async function signedPill(page: Page, op: 'eq' | 'ne', value: string): Promise<{key: string; label: string}> {
    const json = await (await page.request.get(`${PILL_PAGE}/page.json`)).json();
    const chart = firstFilterable(json.widgets);
    if (!chart) throw new Error(`${PILL_PAGE} has no chart that filters`);
    const pill = await page.request.get(`${chart.dataUrl}/pill?${new URLSearchParams({field: chart.filterable![0], op, value})}`);
    expect(pill.status()).toBe(200);
    return pill.json();
}

test('a link’s pill shows as a chip, the charts on another table name it as ignored, its × removes it', async ({page}) => {
    const pill = await signedPill(page, 'eq', 'system');
    await page.goto(`${PAGE}?f=${encodeURIComponent(pill.key)}`);
    const chips = page.getByTestId('wb-filter-bar').getByTestId('filter-chip');
    await expect(chips).toHaveCount(1);
    await expect(chips.first()).toHaveText(pill.label);

    const ignored = page.getByTestId('chart-ignored-filters').first();
    await expect(ignored).toBeVisible();
    await expect(ignored).toHaveText(`ignores ${pill.label}`);

    await chips.first().getByRole('button', {name: `Remove ${pill.label}`}).click();
    await expect(chips).toHaveCount(0);
    await expect(page).not.toHaveURL(/[?&]f=/);
    await expect(ignored).toBeHidden();
});

test('an exclude shows ≠; back brings a removed chip back', async ({page}) => {
    const excluded = await signedPill(page, 'ne', 'system');
    const other = await signedPill(page, 'eq', 'a:b');
    await page.goto(`${PAGE}?f=${encodeURIComponent(excluded.key)}&f=${encodeURIComponent(other.key)}`);
    const chips = page.getByTestId('wb-filter-bar').getByTestId('filter-chip');
    await expect(chips).toHaveCount(2);
    await expect(chips.nth(0)).toContainText('≠');
    await expect(chips.nth(1)).toContainText('a:b');

    await chips.nth(0).getByRole('button', {name: `Remove ${excluded.label}`}).click();
    await expect(chips).toHaveCount(1);
    await page.goBack();
    await expect(chips).toHaveCount(2);
});

test('a pill not signed by the server fails the charts with 400', async ({page}) => {
    const answered = page.waitForResponse((response) => response.url().includes('/query?') && response.url().includes('f='));
    await page.goto(`${PAGE}?f=database:eq:system`);
    expect((await answered).status()).toBe(400);
});

test('a link with two `sql` shows two SQL chips; the funnel adds one; × removes one', async ({page}) => {
    const pill = await signedPill(page, 'eq', 'system');
    await page.goto(`${PAGE}?sql=${encodeURIComponent('1 = 1')}&f=${encodeURIComponent(pill.key)}&sql=${encodeURIComponent('2 = 2')}`);
    const chips = page.getByTestId('wb-filter-bar').getByTestId('filter-chip');
    await expect(chips).toHaveCount(3);
    await expect(chips.nth(0)).toHaveText(/SQL:\s*1 = 1/);
    await expect(chips.nth(1)).toHaveText(pill.label);
    await expect(chips.nth(2)).toHaveText(/SQL:\s*2 = 2/);

    await page.getByRole('button', {name: 'Filters'}).click();
    const field = page.getByRole('textbox', {name: 'SQL filter'});
    await expect(field).toBeFocused();
    await field.fill('3 = 3');
    await field.press('Enter');
    await expect(chips).toHaveCount(4);
    await expect(page).toHaveURL(/sql=3(\+|%20)%3D(\+|%20)3/);

    await chips.nth(0).getByRole('button', {name: 'Remove 1 = 1'}).click();
    await expect(chips).toHaveCount(3);
    await expect(page).not.toHaveURL(/sql=1(\+|%20)%3D/);
});

test('a SQL chip is edited in place', async ({page}) => {
    await page.goto(`${PAGE}?sql=${encodeURIComponent('1 = 1')}`);
    const chips = page.getByTestId('wb-filter-bar').getByTestId('filter-chip');
    await chips.first().locator('.d-filter-chip__value').click();
    const field = page.getByRole('textbox', {name: 'SQL filter'});
    await field.fill('1 = 2');
    await field.press('Enter');
    await expect(chips.first()).toHaveText(/SQL:\s*1 = 2/);
    await expect(page).toHaveURL(/sql=1(\+|%20)%3D(\+|%20)2/);
});

test('a filter button toggles in place, pressed while its filter is set, without a chip', async ({page}) => {
    await page.goto(BUTTON_PAGE);
    const button = page.getByTestId('wb-filter-bar').getByRole('button', {name: BUTTON, exact: true});
    const chips = page.getByTestId('wb-filter-bar').getByTestId('filter-chip');
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(chips).toHaveCount(0);
    await expect(page).toHaveURL(/[?&]f=/);
    await expect(page).not.toHaveURL(/[?&]sql=/);

    await page.reload();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await button.click();
    await expect(chips).toHaveCount(0);
    await expect(page).not.toHaveURL(/[?&]f=/);
});

test('a filter button with `...` asks its value, shows it beside it, and a click on it takes a new one', async ({page}) => {
    await page.goto(BUTTON_PAGE);
    const bar = page.getByTestId('wb-filter-bar');
    const button = bar.getByRole('button', {name: VALUE_BUTTON, exact: true});
    await button.click();
    const field = page.getByRole('textbox', {name: 'Parameter value'});
    await field.fill("/it's");
    await field.press('Enter');
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    const value = bar.getByRole('group', {name: VALUE_BUTTON}).locator('.d-filter-button__value');
    await expect(value).toHaveText("/it's");
    await expect(bar.getByTestId('filter-chip')).toHaveCount(0);
    const first = new URL(page.url()).searchParams.getAll('f');
    expect(first).toHaveLength(1);

    await value.click();
    await expect(field).toHaveValue("/it's");
    await field.fill('/api');
    await field.press('Enter');
    await expect(value).toHaveText('/api');
    await expect.poll(() => new URL(page.url()).searchParams.getAll('f')).not.toEqual(first);
    expect(new URL(page.url()).searchParams.getAll('f')).toHaveLength(1);
});
