// @vitest-environment jsdom
// Tests for codemirror.ts: the editor's text, the keys that take it (Enter in an input box, Cmd / Ctrl+Enter always),
// a new line by Shift+Enter, Escape left to what holds the editor, the change event, the selection, and completion of
// ClickHouse's words and the schema's names.
import { currentCompletions, startCompletion } from '@codemirror/autocomplete';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sqlEditors } from './codemirror';
import type { SqlEditor, SqlEditorOptions } from './sql-editor';

let editor: SqlEditor;

/** A new editor of `options` in the document. */
function create(options: Partial<SqlEditorOptions> = {}): SqlEditor {
  editor = sqlEditors.create({ label: 'SQL', ...options });
  document.body.append(editor.fieldElement);
  return editor;
}

afterEach(() => {
  editor?.dispose();
  document.body.replaceChildren();
});

/** Presses `key` in the editor's text, as the browser sends it. */
const press = (key: string, init: KeyboardEventInit = {}) =>
  editor.inputElement.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));

/** The labels the completion offers at the end of the text, asked explicitly. */
async function completions(): Promise<string[]> {
  const view = EditorView.findFromDOM(editor.fieldElement)!;
  view.dispatch({ selection: { anchor: view.state.doc.length } });
  startCompletion(view);
  await vi.waitFor(() => expect(currentCompletions(view.state).length).toBeGreaterThan(0));
  return currentCompletions(view.state).map((c) => c.label);
}

describe('sqlEditors', () => {
  it('holds its text, named and marked for e2e, and replaces it when set; each change fires', () => {
    create({ value: 'SELECT 1', testId: 'sql-text' });
    const changes = vi.fn();
    editor.onDidChangeValue(changes);
    expect(editor.value).toBe('SELECT 1');
    expect(editor.inputElement.getAttribute('aria-label')).toBe('SQL');
    expect(editor.inputElement.dataset.testid).toBe('sql-text');
    editor.value = 'SELECT 2';
    expect(editor.value).toBe('SELECT 2');
    expect(changes).toHaveBeenCalledTimes(1);
    editor.value = 'SELECT 2';
    expect(changes).toHaveBeenCalledTimes(1);
  });

  it('takes the text on Enter in an input box, Shift+Enter starting a new line', () => {
    create({ value: 'a = 1', enterAccepts: true });
    const accepted = vi.fn();
    editor.onDidAccept(accepted);
    editor.select(5, 5);
    press('Enter', { shiftKey: true });
    expect(editor.value).toBe('a = 1\n');
    expect(accepted).not.toHaveBeenCalled();
    press('Enter');
    expect(accepted).toHaveBeenCalledTimes(1);
    expect(editor.value).toBe('a = 1\n');
  });

  it('starts a new line on Enter elsewhere, and takes the text on Cmd / Ctrl+Enter', () => {
    create({ value: 'SELECT 1' });
    const accepted = vi.fn();
    editor.onDidAccept(accepted);
    editor.select(8, 8);
    press('Enter');
    expect(editor.value).toBe('SELECT 1\n');
    expect(accepted).not.toHaveBeenCalled();
    press('Enter', { ctrlKey: true });
    press('Enter', { metaKey: true });
    expect(accepted).toHaveBeenCalled();
  });

  it('leaves Escape to what holds it, its selection kept', () => {
    create({ value: 'status = 1' });
    editor.select(0, 10);
    const escaped = vi.fn();
    document.body.addEventListener('keydown', (event) => escaped(event.defaultPrevented));
    press('Escape');
    expect(escaped).toHaveBeenCalledWith(false);
    expect(EditorView.findFromDOM(editor.fieldElement)!.state.selection.main.to).toBe(10);
  });

  it('selects the part asked, kept inside its text', () => {
    create({ value: 'status = 1' });
    editor.select(0, 6);
    const { main } = EditorView.findFromDOM(editor.fieldElement)!.state.selection;
    expect([main.from, main.to]).toEqual([0, 6]);
    editor.select(0, 99);
    expect(EditorView.findFromDOM(editor.fieldElement)!.state.selection.main.to).toBe(10);
  });

  it('completes keywords in capitals and types and functions as ClickHouse writes them', async () => {
    create({ value: 'SELECT toStartOf' });
    expect(await completions()).toContain('toStartOfInterval');
    editor.value = 'SELECT CAST(x AS DateTi';
    expect(await completions()).toContain('DateTime64');
    editor.value = 'SELECT 1 PREWH';
    expect(await completions()).toContain('PREWHERE');
  });

  it('completes the columns of the default table alone, and those of a table after its name, once the completion is set', async () => {
    create({ value: 'SELECT ho' });
    editor.setCompletion({ schema: { default: { http_logs: [{ label: 'host', type: 'property' }], orders: ['amount'] } }, defaultSchema: 'default', defaultTable: 'http_logs' });
    expect(await completions()).toContain('host');
    editor.value = 'SELECT orders.am';
    expect(await completions()).toContain('amount');
  });
});
