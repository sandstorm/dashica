// Tests for params-state.ts: the params read from `wp` (none for one that is no JSON object of strings), written and
// sent as one `wp`, none while empty; a param set.
import { describe, expect, it } from 'vitest';
import { paramsState, withParam } from './params-state';

const parse = (search: string) => paramsState.parse(new URLSearchParams(search), undefined);

describe('paramsState', () => {
  it('reads the params of wp, none for a missing or broken one, and only its strings', () => {
    expect(parse('?wp=%7B%22path%22%3A%22%5E%2Fapi%22%7D')).toEqual({ path: '^/api' });
    expect(parse('')).toEqual({});
    expect(parse('?wp=%5B1%5D')).toEqual({});
    expect(parse('?wp=nope')).toEqual({});
    expect(parse('?wp=%7B%22a%22%3A1%2C%22b%22%3A%22x%22%7D')).toEqual({ b: 'x' });
  });

  it('writes and sends them as one wp, none while there is no param', () => {
    expect(paramsState.format({ path: '/x' }, undefined)).toEqual([['wp', '{"path":"/x"}']]);
    expect(paramsState.request!({ path: '/x' })).toEqual([['wp', '{"path":"/x"}']]);
    expect(paramsState.format({}, undefined)).toEqual([]);
  });

  it('sets one param, the others kept', () => {
    expect(withParam({ a: '1' }, 'b', '2')).toEqual({ a: '1', b: '2' });
  });
});
