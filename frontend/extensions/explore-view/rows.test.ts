// Tests for rows.ts: the URLs with the query state or the edited query, an edited query's keys, what the answers say,
// the description.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeRows, editedQueryKeys, editedQueryOf, fetchRows, fetchSql, rowsRequest, sqlRequest } from './rows';

afterEach(() => vi.unstubAllGlobals());

describe('rowsRequest', () => {
  it('is the rows URL with the page’s query state, or with the edited query alone', () => {
    const params = new URLSearchParams([['time', '1h'], ['f', 'host:eq:a'], ['f', 'status:ne:200']]);
    expect(rowsRequest('/p/shop/api/3/rows', params)).toBe('/p/shop/api/3/rows?time=1h&f=host%3Aeq%3Aa&f=status%3Ane%3A200');
    expect(rowsRequest('/p/shop/api/3/rows', params, { sql: "SELECT 'a&b'", parameters: { __from: '1761724800' } })).toBe(
      '/p/shop/api/3/rows?exploreSql=SELECT+%27a%26b%27&param___from=1761724800',
    );
  });
});

describe('editedQueryKeys and editedQueryOf', () => {
  it('write an edited query as exploreSql and a param_ per parameter, and read it back', () => {
    const edited = { sql: 'SELECT {v:String}', parameters: { v: "a'b&c", __to: '1761728400' } };
    const keys = new URLSearchParams(editedQueryKeys(edited));
    expect([...keys]).toEqual([['exploreSql', 'SELECT {v:String}'], ['param_v', "a'b&c"], ['param___to', '1761728400']]);
    expect(editedQueryOf(keys)).toEqual(edited);
  });

  it('read nothing without exploreSql, and only the param_ keys with a name', () => {
    expect(editedQueryOf(new URLSearchParams('explore=3&param_v=1'))).toBeUndefined();
    expect(editedQueryOf(new URLSearchParams('explore=3&exploreSql=SELECT+1&param_=x&time=1h'))).toEqual({ sql: 'SELECT 1', parameters: {} });
  });
});

describe('sqlRequest', () => {
  it('is the SQL URL below the chart’s data URL, with the page’s query state', () => {
    expect(sqlRequest('/p/shop/api/3', new URLSearchParams({ time: '1h', sql: 'a > 1' }))).toBe('/p/shop/api/3/sql?time=1h&sql=a+%3E+1');
  });
});

describe('fetchSql', () => {
  it('reads the SQL and its parameters, nothing for a skipped chart, and rejects with the server’s message', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ sql: 'SELECT {v:String}', parameters: { v: 'a' } }));
    expect(await fetchSql('/sql')).toEqual({ sql: 'SELECT {v:String}', parameters: { v: 'a' } });
    vi.stubGlobal('fetch', async () => new Response(null, { status: 204 }));
    expect(await fetchSql('/sql')).toEqual({ sql: '', parameters: {} });
    vi.stubGlobal('fetch', async () => new Response('Explore is not enabled', { status: 404 }));
    await expect(fetchSql('/sql')).rejects.toThrow('404 Explore is not enabled');
  });
});

describe('fetchRows', () => {
  it('reads the rows and what the headers say about them', async () => {
    vi.stubGlobal('fetch', async () => new Response('arrow', { headers: { 'X-Dashica-Rows-Limit': '100000', 'X-Dashica-Diagnostics': '{"ignored":["host"]}' } }));
    const answer = await fetchRows('/rows');
    expect(new TextDecoder().decode(answer.arrow)).toBe('arrow');
    expect({ ...answer, arrow: undefined }).toEqual({ arrow: undefined, limit: 100000, diagnostics: { ignored: ['host'] } });
  });

  it('reads a chart’s result without a limit, and a skipped chart without rows', async () => {
    vi.stubGlobal('fetch', async () => new Response('arrow'));
    expect(await fetchRows('/rows')).toMatchObject({ limit: undefined, diagnostics: {} });
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
