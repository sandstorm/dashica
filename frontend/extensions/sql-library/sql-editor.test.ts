// @vitest-environment jsdom
// Tests for sql-editor.ts: the completion of a schema (its own database the default, a page table's columns alone),
// and the SQL input box: its field the SQL editor, its completion set once known, the editor gone after; the box's
// own field while the editor does not load.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Schema } from '../../generated/zz_generated.dashica';
import type { InputBoxOptions } from '../../hosts/ui/ui';
import { completionOf, showSqlInputBox, type SqlCompletion, type SqlEditor, type SqlEditors } from './sql-editor';

const column = (name: string, type: string, comment = '') => ({ name, type, defaultKind: '', defaultExpression: '', comment });
const table = (name: string, columns: Schema['databases'][number]['tables'][number]['columns']) => ({
  name,
  engine: 'MergeTree',
  sortingKey: '',
  partitionKey: '',
  primaryKey: '',
  ttl: '',
  comment: '',
  columns,
  skipIndices: [],
});
const schema: Schema = {
  database: 'default',
  databases: [
    { name: 'default', tables: [table('http_logs', [column('host', 'String', 'the host asked'), column('status', 'UInt16')])] },
    { name: 'logs', tables: [table('audit', [column('user', 'String')])] },
  ],
};

describe('completionOf', () => {
  it('names each database, table and column, a column with its type and comment; the connection’s database the default', () => {
    expect(completionOf(schema)).toEqual({
      schema: {
        default: {
          http_logs: [
            { label: 'host', type: 'property', detail: 'String', info: 'the host asked' },
            { label: 'status', type: 'property', detail: 'UInt16' },
          ],
        },
        logs: { audit: [{ label: 'user', type: 'property', detail: 'String' }] },
      },
      defaultSchema: 'default',
    });
  });

  it('makes a page table the default table, in its database when it names one', () => {
    expect(completionOf(schema, 'http_logs')).toMatchObject({ defaultSchema: 'default', defaultTable: 'http_logs' });
    expect(completionOf(schema, 'logs.audit')).toMatchObject({ defaultSchema: 'logs', defaultTable: 'audit' });
  });
});

describe('showSqlInputBox', () => {
  afterEach(() => vi.restoreAllMocks());

  /** The SQL editors of codemirror.ts, each editor made kept in `made`, its `dispose` and `setCompletion` watched. */
  const made: SqlEditor[] = [];
  const editors = async (): Promise<SqlEditors> => {
    const { sqlEditors } = await import('./codemirror');
    return {
      create: (options) => {
        const editor = sqlEditors.create(options);
        vi.spyOn(editor, 'dispose');
        vi.spyOn(editor, 'setCompletion');
        made.push(editor);
        return editor;
      },
    };
  };

  it('asks in the input box with the SQL editor as its field, Enter taking the text; sets the completion once known; disposes the editor after', async () => {
    const asked: InputBoxOptions[] = [];
    const ui = { showInputBox: async (options: InputBoxOptions) => (asked.push(options), options.field!.value) };
    const completion: SqlCompletion = { schema: { default: { http_logs: ['host'] } }, defaultSchema: 'default' };
    const anchor = document.createElement('button');
    const answer = await showSqlInputBox(ui, editors, { title: 'SQL condition', prompt: 'p', value: 'a = 1', anchor, completion: Promise.resolve(completion) });
    expect(answer).toBe('a = 1');
    expect(asked).toEqual([expect.objectContaining({ title: 'SQL condition', prompt: 'p', anchor, field: made.at(-1) })]);
    const editor = made.at(-1)!;
    expect(editor.input.getAttribute('aria-label')).toBe('SQL condition');
    expect(editor.setCompletion).toHaveBeenCalledWith(completion);
    expect(editor.dispose).toHaveBeenCalled();
  });

  it('asks with the box’s own field while the editor does not load, saying so on the console', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const asked: InputBoxOptions[] = [];
    const ui = { showInputBox: async (options: InputBoxOptions) => (asked.push(options), 'b = 2') };
    const failing = () => Promise.reject(new Error('404'));
    expect(await showSqlInputBox(ui, failing, { title: 'SQL condition', placeholder: 'e.g.', value: 'b' })).toBe('b = 2');
    expect(asked).toEqual([{ title: 'SQL condition', prompt: undefined, placeholder: 'e.g.', value: 'b', anchor: undefined }]);
    expect(logged).toHaveBeenCalled();
  });
});
