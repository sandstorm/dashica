// Tests for decorations.ts: a chart's Diagnostics as its decorations, a badge per ignored pill (muted) or why it did
// not run.
import { Table } from 'apache-arrow';
import { describe, expect, it } from 'vitest';
import type { QueryResult, RenderedWidget } from '../../hosts/widgets/widgets';
import { filterDecorationProvider, filterDecorations } from './decorations';

describe('filterDecorations', () => {
  it('has a muted badge per ignored pill, in order, and none without', () => {
    expect(filterDecorations({ ignored: ['host = a', 'customer ≠ acme'] })).toEqual([
      { badge: 'ignores host = a', tooltip: 'The chart does not apply the filter host = a', muted: true, source: 'filters' },
      { badge: 'ignores customer ≠ acme', tooltip: 'The chart does not apply the filter customer ≠ acme', muted: true, source: 'filters' },
    ]);
    expect(filterDecorations({})).toEqual([]);
  });

  it('says only why a chart did not run, unmuted', () => {
    expect(filterDecorations({ skipped: 'pick a host', ignored: ['path = /'] })).toEqual([{ badge: 'skipped: pick a host', tooltip: 'The chart did not run', source: 'filters' }]);
  });
});

describe('filterDecorationProvider', () => {
  it('decorates an answer by its X-Dashica-Diagnostics', () => {
    const result: QueryResult = Object.assign(new Table(), { headers: new Headers({ 'X-Dashica-Diagnostics': '{"ignored":["host = a"]}' }) });
    expect(filterDecorationProvider.provideDecorations({} as RenderedWidget, result)?.map(({ badge }) => badge)).toEqual(['ignores host = a']);
  });
});
