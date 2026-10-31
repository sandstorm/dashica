// Tests for rows.ts: the URLs with the query state or the edited SQL, what the answers say, the description.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeRows, fetchRows, fetchSql, rowsRequest, sqlRequest } from './rows';

afterEach(() => vi.unstubAllGlobals());

describe('rowsRequest', () => {
  it('is the rows URL with the page’s query state, or with the edited SQL alone', () => {
    const params = new URLSearchParams([['time', '1h'], ['f', 'host:eq:a'], ['f', 'status:ne:200']]);
    expect(rowsRequest('/p/shop/api/3/rows', params)).toBe('/p/shop/api/3/rows?time=1h&f=host%3Aeq%3Aa&f=status%3Ane%3A200');
    expect(rowsRequest('/p/shop/api/3/rows', params, "SELECT 'a&b'")).toBe('/p/shop/api/3/rows?xsql=SELECT+%27a%26b%27');
  });
});

describe('sqlRequest', () => {
  it('is the SQL URL below the chart’s data URL, with the page’s query state', () => {
    expect(sqlRequest('/p/shop/api/3', new URLSearchParams({ time: '1h', sql: 'a > 1' }))).toBe('/p/shop/api/3/sql?time=1h&sql=a+%3E+1');
  });
});

describe('fetchSql', () => {
  it('reads the text, nothing for a skipped chart, and rejects with the server’s message', async () => {
    vi.stubGlobal('fetch', async () => new Response('SELECT 1'));
    expect(await fetchSql('/sql')).toBe('SELECT 1');
    vi.stubGlobal('fetch', async () => new Response(null, { status: 204 }));
    expect(await fetchSql('/sql')).toBe('');
    vi.stubGlobal('fetch', async () => new Response('Explore is not enabled', { status: 404 }));
    await expect(fetchSql('/sql')).rejects.toThrow('404 Explore is not enabled');
  });
});

describe('fetchRows', () => {
  it('reads the rows and what the headers say about them', async () => {
    vi.stubGlobal('fetch', async () => new Response('arrow', { headers: { 'X-Dashica-Sql': 'editable', 'X-Dashica-Rows-Limit': '100000', 'X-Dashica-Diagnostics': '{"ignored":["host"]}' } }));
    const answer = await fetchRows('/rows');
    expect(new TextDecoder().decode(answer.arrow)).toBe('arrow');
    expect({ ...answer, arrow: undefined }).toEqual({ arrow: undefined, sqlEditable: true, limit: 100000, diagnostics: { ignored: ['host'] } });
  });

  it('reads a chart’s result whose SQL is not editable, and a skipped chart without rows', async () => {
    vi.stubGlobal('fetch', async () => new Response('arrow'));
    expect(await fetchRows('/rows')).toMatchObject({ sqlEditable: false, limit: undefined, diagnostics: {} });
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
    expect(describeRows({ limit: 100000 }, 100000)).toBe('the first 100,000 rows (limit)');
  });
});
