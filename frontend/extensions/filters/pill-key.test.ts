// @vitest-environment jsdom
// Tests for what a pill's key says of itself: its label (pillLabel), the filter button it was made for (pillButton),
// the field or column it filters by (pillField). The keys are written as lib/dashboard/filter's Sign writes them
// (its tests check that), each with the mac `mac`.
import { describe, expect, it } from 'vitest';
import { pillButton, pillField, pillLabel } from './pill-key';

describe('pillLabel and pillButton', () => {
  it("read the filter button a pill was made for with its value, and label it by both", () => {
    const duration = '@duration_ms >= ...~500~mac';
    expect([pillLabel(duration), pillButton(duration)]).toEqual(['duration_ms >= ...: 500', { button: 'duration_ms >= ...', value: '500' }]);
    expect([pillLabel('@status >= 500~mac'), pillButton('@status >= 500~mac')]).toEqual(['status >= 500', { button: 'status >= 500', value: '' }]);
    expect(pillButton("@path ILIKE concat(..., '%25') %7E 1~a%7Eb~mac")).toEqual({ button: "path ILIKE concat(..., '%') ~ 1", value: 'a~b' });
  });

  it("read no button from a field's pill, and the key itself as the label of one it cannot read", () => {
    expect(pillButton('http_logs.host=a~mac')).toBeUndefined();
    expect([pillLabel('status:eq:500'), pillButton('status:eq:500'), pillButton('@a~b~c~mac'), pillButton('@%zz~mac')]).toEqual([
      'status:eq:500',
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe('pillField', () => {
  const host = { connection: 'default', table: 'http_logs', field: 'host', op: 'ne', value: "O'Brien" };

  it("reads the table, field, op and shown value of a computed field's pill, an empty value too, and labels it", () => {
    const key = "http_logs.host!=O'Brien~(JSONExtractString(attrs, 'host')) != 'O\\'Brien'~mac";
    expect([pillField(key), pillLabel(key)]).toEqual([host, "host ≠ O'Brien"]);
    expect(pillField('http_logs.host=~x~mac')).toEqual({ ...host, op: 'eq', value: '' });
  });

  it('reads a column’s pill: one without a condition', () => {
    expect(pillField("http_logs.host!=O'Brien~mac")).toEqual({ ...host, column: true });
  });

  it('reads each op', () => {
    const ops = Object.entries({ '=': 'eq', '!=': 'ne', '<': 'lt', '<=': 'le', '>': 'gt', '>=': 'ge' });
    expect(ops.map(([operator]) => pillField(`http_logs.status${operator}500~mac`)?.op)).toEqual(ops.map(([, op]) => op));
  });

  it('reads the connection and the database when the key names them', () => {
    expect(pillField('logs:full_logs.host=a~mac')).toMatchObject({ connection: 'logs', table: 'full_logs' });
    expect(pillField('logs:default.full_logs.host=a~mac')).toMatchObject({ connection: 'logs', table: 'default.full_logs' });
    expect(pillField('system.one.dummy>1~mac')).toMatchObject({ connection: 'default', table: 'system.one', field: 'dummy', op: 'gt', value: '1' });
  });

  it('reads the separators percent-encoded in a name and a value as they were', () => {
    expect(pillField('a%3Ab:x%2Ey.a%2Epath%3Dx=a%7Eb.c=d!e<f>g%25~mac')).toEqual({
      connection: 'a:b',
      table: 'x.y',
      field: 'a.path=x',
      column: true,
      op: 'eq',
      value: 'a~b.c=d!e<f>g%',
    });
    expect(pillField('http_logs.status<%3D5~mac')).toMatchObject({ op: 'lt', value: '=5' });
  });

  it("reads none from a button's pill or a key it cannot read", () => {
    expect(
      ['@status >= 500~mac', 'status:eq:500', 'http_logs.host=a', 'http_logs.host~mac', 'host=a~mac', 'a.b.c.host=a~mac', 'http_logs.host=%zz~mac', 'a~b~c~mac'].map(
        pillField,
      ),
    ).toEqual(Array(8).fill(undefined));
  });
});
