// Tests for the filter bar's "Add filter" (docs/2026-10-28-workbench.md §3.14 D15, step 8m): a field of a table the
// page's charts filter, `=`, a value from the field's chart's `/values` (narrowed as one types), added as a signed
// pill; `/values` answers 422 for a field that cannot filter.
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
    // one table per page here: the box asks for a field first; a page with several asks for the table before
    await expect(options.first()).toBeVisible();
    const field = (await options.first().textContent())!.trim();
    await page.keyboard.press('Enter');
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
