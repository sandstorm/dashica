// Tests for the filter bar's "Add filter" (docs/2026-10-28-workbench.md §3.14 D15, step 8m): a column of a table the
// page's charts read, `=`, a value from the chart's `/values` (narrowed as one types), added as a signed pill; the
// field step's "Table columns" (the schema's, `/columns`) and "Computed fields", no constant (a fixed colour such as
// `'#D73027' AS darkred`) among them (D27); its last entry "SQL condition…" under "Advanced" only while SQL chips are
// taken (D26); `/values` answers 422 for a field that cannot filter, `/pill` for a column the table lacks.
//
// The page defaults to the Sandstorm instance's "/templates/oekokiste-caddy-ingress", whose charts filter its table;
// another page: DASHICA_E2E_ADD_FILTER_PAGE.
import {expect, test} from '@playwright/test';

const PAGE = process.env.DASHICA_E2E_ADD_FILTER_PAGE || '/templates/oekokiste-caddy-ingress';

test('"Add filter" adds a pill on a value the field’s chart offers', async ({page}) => {
    await page.goto(PAGE);
    await page.getByRole('button', {name: 'Add filter'}).click();

    const box = page.locator('.d-workbench__quick-pick');
    const options = box.getByRole('option');
    // one table per page here: the box asks for a field first; a page with several asks for the table before. A
    // column of a string type (its type beside its name), whose first op is `=`
    const column = options.filter({hasText: /String/}).first();
    await expect(column).toBeVisible();
    const field = (await column.textContent())!.trim().split(/\s/)[0];
    await column.click();
    await expect(options.first()).toContainText(`${field} = …`);
    await page.keyboard.press('Enter');

    await expect(options.first()).toBeVisible();
    const value = (await options.first().textContent())!.trim();
    await page.keyboard.type(value.slice(0, 2));
    await expect(options.filter({hasText: value}).first()).toBeVisible();
    await options.filter({hasText: value}).first().click();

    const chips = page.getByTestId('wb-filter-bar').getByTestId('filter-chip');
    await expect(chips).toHaveCount(1);
    // the chip shows an empty value as the box does, "(empty)", so that it can be clicked to change it
    await expect(chips.first()).toHaveText(`${field} = ${value}`);
    await expect(page).toHaveURL(/[?&]f=/);
});

test('"Add filter" groups the table’s columns and the computed fields, without a constant', async ({page}) => {
    await page.goto(PAGE);
    await page.getByRole('button', {name: 'Add filter'}).click();
    const box = page.locator('.d-workbench__quick-pick');
    await expect(box.getByRole('option').first()).toBeVisible();

    const headings = await box.locator('.d-workbench__quick-pick-heading').allTextContents();
    expect(headings[0]).toContain('Table columns');
    const labels = (await box.getByRole('option').allTextContents()).map((label) => label.trim());
    // the template's fixed colours (`'#D73027'` as darkred) filter nothing
    expect(labels.filter((label) => label.startsWith("'") || label === 'darkred')).toEqual([]);
    expect(new Set(labels).size).toBe(labels.length);
});

test('/columns answers the table’s columns; /pill refuses a column it lacks', async ({page}) => {
    const json = await (await page.request.get(`${PAGE}/page.json`)).json();
    const find = (nodes: {dataUrl?: string; table?: string; children?: Record<string, unknown>}[]): string | undefined => {
        for (const node of nodes) {
            if (node.dataUrl && node.table) return node.dataUrl;
            const inner = find(Object.values(node.children ?? {}) as typeof nodes);
            if (inner) return inner;
        }
        return undefined;
    };
    const dataUrl = find(json.widgets);
    expect(dataUrl).toBeDefined();
    const columns = await (await page.request.get(`${dataUrl}/columns?time=1h`)).json();
    expect(columns.columns.length).toBeGreaterThan(0);
    expect(columns.columns[0]).toEqual(expect.objectContaining({name: expect.any(String), type: expect.any(String)}));
    const refused = await page.request.get(`${dataUrl}/pill?column=__no_such_column&op=eq&value=1`);
    expect(refused.status()).toBe(422);
});

test('"Add filter" ends with "SQL condition…" only while SQL chips are taken (filters.sqlEnabled)', async ({page, request}) => {
    const workbench = await (await request.get('/workbench.json')).json();
    await page.goto(PAGE);
    await page.getByRole('button', {name: 'Add filter'}).click();
    const options = page.locator('.d-workbench__quick-pick').getByRole('option');
    await expect(options.first()).toBeVisible();
    await expect(options.filter({hasText: 'SQL condition…'})).toHaveCount(workbench.sqlEnabled ? 1 : 0);
    if (workbench.sqlEnabled) await expect(options.last()).toContainText('SQL condition…');
});

test('/values answers 422 for a field that cannot filter', async ({page}) => {
    const json = await (await page.request.get(`${PAGE}/page.json`)).json();
    const find = (nodes: {dataUrl?: string; filterable?: string[]; children?: Record<string, unknown>}[]): string | undefined => {
        for (const node of nodes) {
            if (node.dataUrl && node.filterable?.length) return node.dataUrl;
            const inner = find(Object.values(node.children ?? {}) as typeof nodes);
            if (inner) return inner;
        }
        return undefined;
    };
    const dataUrl = find(json.widgets);
    expect(dataUrl).toBeDefined();
    const answer = await page.request.get(`${dataUrl}/values?time=1h&field=__no_such_field`);
    expect(answer.status()).toBe(422);
});
