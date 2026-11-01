// Tests for chips.ts: the chips read from the URL's f and sql in their order and written back so, an empty one none;
// a chip added once, replaced in its place, removed by index or predicate.
import { describe, expect, it } from 'vitest';
import { FILTERS, addChip, removeChips, replaceChip, type FilterChip } from './chips';

const sql = (condition: string): FilterChip => ({ kind: 'sql', sql: condition });
const pill = (key: string): FilterChip => ({ kind: 'pill', key });

describe('FILTERS', () => {
  it('takes one chip per f and sql in the URL’s order, the keys as they are; an empty f or sql is none', () => {
    const url = new URLSearchParams('?sql=a+%0AAND+b&f=k1.mac&sql=&f=&f=status:eq:500&sql=duration+%3E+2000&time=1h');
    expect(FILTERS.parse(url, undefined)).toEqual([sql('a \nAND b'), pill('k1.mac'), pill('status:eq:500'), sql('duration > 2000')]);
    expect(FILTERS.parse(new URLSearchParams(''), undefined)).toEqual([]);
  });

  it('writes and sends the chips in their order, f and sql interleaved', () => {
    const chips = [sql('duration > 2000'), pill('k1.mac'), sql("level != 'info'")];
    const entries = [
      ['sql', 'duration > 2000'],
      ['f', 'k1.mac'],
      ['sql', "level != 'info'"],
    ];
    expect(FILTERS.format(chips)).toEqual(entries);
    expect(FILTERS.sentToServer).toBe(true);
    expect(FILTERS.parse(new URLSearchParams(entries as [string, string][]), undefined)).toEqual(chips);
  });
});

describe('addChip, replaceChip, removeChips', () => {
  it('add a chip once (a pill by its key), none of only spaces', () => {
    const chips = addChip(addChip([], sql('a')), pill('k1.mac'));
    expect(chips).toEqual([sql('a'), pill('k1.mac')]);
    expect(addChip(chips, pill('k1.mac'))).toBe(chips);
    expect(addChip(chips, sql('a'))).toBe(chips);
    expect(addChip(chips, sql('  '))).toBe(chips);
  });

  it('replace a chip in its place; one of only spaces or one there already removes it, the same again or a missing index nothing', () => {
    const chips = [sql('a'), pill('k1.mac'), sql('b')];
    expect(replaceChip(chips, 1, pill('k2.mac'))).toEqual([sql('a'), pill('k2.mac'), sql('b')]);
    expect(replaceChip(chips, 2, sql(' '))).toEqual([sql('a'), pill('k1.mac')]);
    expect(replaceChip(chips, 0, pill('k1.mac'))).toEqual([pill('k1.mac'), sql('b')]);
    expect(replaceChip(chips, 1, pill('k1.mac'))).toBe(chips);
    expect(replaceChip(chips, 5, sql('c'))).toBe(chips);
  });

  it('remove a chip by its index or every chip a predicate holds for, nothing when none is', () => {
    const chips = [sql('a'), pill('k1.mac'), sql('b')];
    expect(removeChips(chips, 1)).toEqual([sql('a'), sql('b')]);
    expect(removeChips(chips, (chip) => chip.kind === 'sql')).toEqual([pill('k1.mac')]);
    expect(removeChips(chips, 5)).toBe(chips);
    expect(removeChips(chips, () => false)).toBe(chips);
  });
});
