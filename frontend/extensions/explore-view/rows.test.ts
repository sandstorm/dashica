// Tests for rows.ts: the URL with the query state, what the answer's headers say, the description.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeRows, fetchRows, rowsRequest } from './rows';

afterEach(() => vi.unstubAllGlobals());

describe('rowsRequest', () => {
  it('is the rows URL with the page’s query state, grouping=none for the rows without grouping', () => {
    const params = new URLSearchParams([['time', '1h'], ['f', 'host:eq:a'], ['f', 'status:ne:200']]);
    expect(rowsRequest('/p/shop/api/3/rows', params)).toBe('/p/shop/api/3/rows?time=1h&f=host%3Aeq%3Aa&f=status%3Ane%3A200');
    expect(rowsRequest('/p/shop/api/3/rows', params, true)).toBe('/p/shop/api/3/rows?time=1h&f=host%3Aeq%3Aa&f=status%3Ane%3A200&grouping=none');
    expect(params.has('grouping')).toBe(false);
  });
});

describe('fetchRows', () => {
  it('reads the rows and what the headers say about them', async () => {
    vi.stubGlobal('fetch', async () => new Response('arrow', { headers: { 'X-Dashica-Grouping': 'removable', 'X-Dashica-Rows-Limit': '100000', 'X-Dashica-Diagnostics': '{"ignored":["host"]}' } }));
    const answer = await fetchRows('/rows');
    expect(new TextDecoder().decode(answer.arrow)).toBe('arrow');
    expect({ ...answer, arrow: undefined }).toEqual({ arrow: undefined, groupingRemovable: true, limit: 100000, diagnostics: { ignored: ['host'] } });
  });

  it('reads a chart’s result whose grouping stays, and a skipped chart without rows', async () => {
    vi.stubGlobal('fetch', async () => new Response('arrow'));
    expect(await fetchRows('/rows')).toMatchObject({ groupingRemovable: false, limit: undefined, diagnostics: {} });
    vi.stubGlobal('fetch', async () => new Response(null, { status: 204, headers: { 'X-Dashica-Diagnostics': '{"skipped":"pick a host"}' } }));
    expect(await fetchRows('/rows')).toMatchObject({ arrow: undefined, diagnostics: { skipped: 'pick a host' } });
  });

  it('rejects with the server’s message', async () => {
    vi.stubGlobal('fetch', async () => new Response('Code: 60. Table does not exist', { status: 500 }));
    await expect(fetchRows('/rows')).rejects.toThrow('500 Code: 60. Table does not exist');
  });
});

describe('describeRows', () => {
  it('says whose rows they are, and when the limit cut them', () => {
    expect(describeRows({ limit: undefined }, 24)).toBe('24 rows of the chart’s result');
    expect(describeRows({ limit: 100000 }, 1234)).toBe('1,234 rows');
    expect(describeRows({ limit: 100000 }, 100000)).toBe('the newest 100,000 rows (limit)');
  });
});
