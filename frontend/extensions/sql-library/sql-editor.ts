import type { SQLNamespace } from '@codemirror/lang-sql';
import type { Schema } from '../../generated/zz_generated.dashica';
import type { InputBoxField, MenuAnchor, UiApi } from '../../hosts/ui/ui';

/**
 * Dashica's SQL editor as its users see it: CodeMirror 6 with a ClickHouse dialect, from the bundle
 * public/dist/sql-editor.js (codemirror.ts, frontendBuild.mjs), which is loaded on first use (`loadSqlEditors`), so
 * only the pages that open an editor load it. The Explore view's editor and the filter bar's SQL condition
 * (`showSqlInputBox`) are both one of these.
 */
export interface SqlEditors {
  /** A new editor, outside the document: its owner puts `fieldElement` where it wants it and disposes it. */
  create(options: SqlEditorOptions): SqlEditor;
}

export interface SqlEditorOptions {
  /** The text at first. */
  readonly value?: string;
  readonly placeholder?: string;
  /** The accessible name of its text ("SQL"). */
  readonly label: string;
  /** Its text's `data-testid` (e2e). */
  readonly testId?: string;
  /**
   * Enter takes the text (`onDidAccept`) and Shift+Enter starts a new line, as in an input box; else Enter starts a new
   * line. Cmd / Ctrl+Enter takes it either way (Explore's Run). An open completion takes Enter first.
   */
  readonly enterAccepts?: boolean;
  /** What it completes besides ClickHouse's keywords, types and functions; `setCompletion` changes it. */
  readonly completion?: SqlCompletion;
}

/** An editor of `SqlEditors.create`; as the input box's field it is `InputBoxOptions.field`. */
export interface SqlEditor extends InputBoxField {
  /** The text in it; setting it replaces the whole text. */
  value: string;
  /** Completes the names `completion` holds from now on; `undefined`: only ClickHouse's own words. */
  setCompletion(completion: SqlCompletion | undefined): void;
  /** Takes it away, its events with it. */
  dispose(): void;
}

/**
 * What the editor completes besides ClickHouse's words (lang-sql's `schema`, `defaultSchema` and `defaultTable`):
 * database › table › columns; the tables of `defaultSchema` also without their database, the columns of
 * `defaultTable` (in `defaultSchema`) also without their table.
 */
export interface SqlCompletion {
  readonly schema: SQLNamespace;
  readonly defaultSchema?: string;
  readonly defaultTable?: string;
}

/** Where the build puts the SQL editor's bundle (frontendBuild.mjs), beside index.js. */
export const SQL_EDITOR_URL = '/public/dist/sql-editor.js';

/** The SQL editor's bundle at `url`; the browser imports a module once, so a second call costs nothing. */
export async function loadSqlEditors(url = SQL_EDITOR_URL): Promise<SqlEditors> {
  const module: { sqlEditors: SqlEditors } = await import(/* @vite-ignore */ url);
  return module.sqlEditors;
}

/**
 * The completion of `schema` (`/schema.json`'s): each database with its tables, each table with its columns (the
 * type as the detail, the comment as the info); its own database the default, so that its tables complete without it;
 * with `table` (`page.json`'s short form, `http_logs` or `logs.http_logs`) that table's columns also alone.
 */
export function completionOf(schema: Schema, table?: string): SqlCompletion {
  const namespace: Record<string, Record<string, SQLNamespace>> = {};
  for (const database of schema.databases) {
    const tables: Record<string, SQLNamespace> = {};
    for (const t of database.tables) {
      tables[t.name] = t.columns.map((column) => ({ label: column.name, type: 'property', detail: column.type, ...(column.comment ? { info: column.comment } : {}) }));
    }
    namespace[database.name] = tables;
  }
  const dot = table?.indexOf('.') ?? -1;
  const defaultSchema = table && dot >= 0 ? table.slice(0, dot) : schema.database;
  const defaultTable = table && dot >= 0 ? table.slice(dot + 1) : table;
  return { schema: namespace, defaultSchema, ...(defaultTable ? { defaultTable } : {}) };
}

/** What `showSqlInputBox` asks with. */
export interface SqlInputBoxOptions {
  /** The box's name ("SQL condition"). */
  readonly title: string;
  readonly prompt?: string;
  readonly placeholder?: string;
  /** The text at first, all of it selected. */
  readonly value?: string;
  readonly anchor?: MenuAnchor;
  /** What the editor completes once it is known; without it, or while it fails, only ClickHouse's words. */
  readonly completion?: Promise<SqlCompletion | undefined>;
}

/**
 * Asks for SQL in the input box at `options.anchor`, its field the SQL editor of `editors` (Enter takes the text,
 * Shift+Enter a new line, completion as `options.completion` says once it is known): resolves as `showInputBox` does.
 * When the editor's bundle fails to load (logged on the console), the box's own one-line field asks instead.
 */
export async function showSqlInputBox(
  ui: Pick<UiApi, 'showInputBox'>,
  editors: () => Promise<SqlEditors>,
  options: SqlInputBoxOptions,
): Promise<string | undefined> {
  const { title, prompt, placeholder, value, anchor } = options;
  let loaded: SqlEditors;
  try {
    loaded = await editors();
  } catch (error) {
    console.error('The SQL editor did not load:', error);
    return ui.showInputBox({ title, prompt, placeholder, value, anchor });
  }
  const field = loaded.create({ label: title, placeholder, value, enterAccepts: true });
  void options.completion?.then(
    (completion) => field.setCompletion(completion),
    () => undefined,
  );
  try {
    return await ui.showInputBox({ title, prompt, anchor, field });
  } finally {
    field.dispose();
  }
}
