// Tests for what a pill's key says of itself: its label (pillLabel), the filter button it was made for (pillButton),
// the field or column it filters by (pillField).
import { describe, expect, it } from 'vitest';
import { pillButton, pillField, pillLabel } from './pill-key';

/** A key as the server signs a pill (`<payload>.<mac>`, the payload base64url JSON) with `label`; its mac is none. */
function keyOf(label: string, payload: object = {}): string {
  const json = new TextEncoder().encode(JSON.stringify({ condition: 'x', label, ...payload }));
  return `${btoa(String.fromCharCode(...json)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.mac`;
}

describe('pillLabel and pillButton', () => {
  it("read a pill's label, and the filter button it was made for with its value", () => {
    const duration = keyOf('Duration: 500', { button: 'duration_ms >= ...', value: '500' });
    expect([pillLabel(duration), pillButton(duration)]).toEqual(['Duration: 500', { button: 'duration_ms >= ...', value: '500' }]);
    expect(pillButton(keyOf('Errors', { button: 'status >= 500' }))).toEqual({ button: 'status >= 500', value: '' });
  });

  it('read no button from the pill of a field, and the key itself as the label of one without a payload', () => {
    expect(pillButton(keyOf('host = a'))).toBeUndefined();
    expect([pillLabel('status:eq:500'), pillButton('status:eq:500'), pillButton('!!.mac')]).toEqual(['status:eq:500', undefined, undefined]);
  });
});

describe('pillField', () => {
  const host = { connection: 'default', table: 'default.http_logs', field: 'host', op: 'ne', value: "O'Brien" };

  it("reads the table, field, op and shown value of a field's pill, an empty value too", () => {
    expect(pillField(keyOf("host ≠ O'Brien", host))).toEqual(host);
    expect(pillField(keyOf('host = ', { ...host, op: 'eq', value: '' }))).toEqual({ ...host, op: 'eq', value: '' });
  });

  it('reads a range op and the type the pill was made with', () => {
    const since = { ...host, field: 'timestamp', op: 'ge', value: '2026-10-31T10:00:00.000Z', type: 'DateTime' };
    expect(pillField(keyOf('timestamp ≥ 2026-10-31T10:00:00.000Z', since))).toEqual(since);
  });

  it('reads whether it is a column’s pill', () => {
    const user = { ...host, field: 'user', column: true };
    expect(pillField(keyOf("user ≠ O'Brien", user))).toEqual(user);
    expect(pillField(keyOf("host ≠ O'Brien", { ...host, column: 'yes' }))).toEqual(host);
  });

  it('reads none from a key without a value, signed before pills carried it', () => {
    expect(pillField(keyOf('host = acme', { ...host, op: 'eq', value: undefined }))).toBeUndefined();
  });

  it("reads none from a button's pill, a key without a field or op, or one without a payload", () => {
    const button = { connection: '', table: '', field: '', op: '', button: 'status >= 500' };
    expect([pillField(keyOf('Errors', button)), pillField(keyOf('host = a')), pillField(keyOf('host', { ...host, op: 'like' })), pillField('status:eq:500')]).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});
