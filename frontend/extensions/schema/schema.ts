import { html } from 'htl';
import { Database, RefreshCw, createElement } from 'lucide';
import type { PageJson, Schema, SchemaTable, WidgetNode } from '../../generated/zz_generated.dashica';
import type { Extension } from '../../hosts/extension-host/extension-host';
import { createView } from '../../hosts/ui/ui';
import { Schemas } from '../sql-library/schemas';
import './schema.css';

/**
 * The left side panel "Schema", only with Explore enabled (`workbench.json`'s `explore`: it is part of Explore,
 * Perspective concept §4.8), as two views: "On this page", the tables the shown page's charts read (`page.json`'s
 * `table` and `connection` of each chart) as connection › database › table, drawn anew for each page shown; and "All
 * connections", the tree connection › database › table of every ClickHouse connection of dashica_config
 * (`workbench.json`'s `connections`). A connection's schema is asked from `/schema.json` once (`Schemas`), by "On this
 * page" while the panel shows, by a connection of "All connections" when it is opened the first time; a table opens to
 * what DataGrip shows of one: its columns (type, default, comment), engine, ORDER BY, PARTITION BY, primary key, TTL
 * and skip indices. The server keeps each connection's schema; "Refresh" in the panel's "…" asks it again for the
 * connections asked so far, "Show comments" there shows or hides the columns' and tables' comments (kept in
 * `globalState`, as whether a view is closed). A tree element of "All connections" stays as the viewer left it (open
 * or closed) when another page is shown.
 */
export const schema: Extension = {
  id: 'schema',
  activate({ ui, page, commands, globalState, subscriptions }) {
    if (!page.workbench.explore) return;
    const panel = ui.registerSidePanel('schema', { label: 'Schema', icon: createElement(Database).outerHTML, order: 30 });
    const schemas = new Schemas();
    const connections = page.workbench.connections.map((name) => connectionNode(name, schemas));
    const onPage: HTMLElement = html`<div class="d-schema__tree"></div>`;
    const root: HTMLElement = html`<div class="d-schema">
      ${createView({ id: 'page', title: 'On this page', state: globalState, body: onPage })}
      ${createView({
        id: 'all',
        title: 'All connections',
        state: globalState,
        body: html`<div class="d-schema__tree">${connections.length === 0 ? html`<div class="d-schema__hint">No connections.</div>` : connections.map((c) => c.element)}</div>`,
      })}
    </div>`;
    panel.bodyContainer.replaceChildren(root);

    let showComments = globalState.get('showComments', true);
    const drawComments = () => root.classList.toggle('d-schema--no-comments', !showComments);
    drawComments();

    /** The page "On this page" shows; `null` before it showed one. */
    let drawnFor: PageJson | undefined | null = null;
    const drawPage = (again = false) => {
      if (!panel.visible || (!again && drawnFor === page.current)) return;
      drawnFor = page.current;
      onPage.replaceChildren(...drawPageTables(page.workbench.connections, pageTables(page.current), schemas));
    };
    drawPage();
    subscriptions.push(
      panel,
      page.onDidChangePage(() => drawPage()),
      panel.onDidChangeVisibility(() => drawPage()),
      commands.registerCommand('schema.refresh', async () => {
        await Promise.all(schemas.asked.map((name) => schemas.get(name, true).catch(() => undefined)));
        drawnFor = null;
        drawPage();
        await Promise.all(connections.map((connection) => connection.refresh()));
      }),
      ui.registerMenuItem('panel/schema', { command: 'schema.refresh', title: 'Refresh', icon: createElement(RefreshCw).outerHTML }),
      commands.registerCommand('schema.toggleComments', () => {
        showComments = !showComments;
        drawComments();
        return globalState.update('showComments', showComments);
      }),
      ui.registerMenuItem('panel/schema', { command: 'schema.toggleComments', title: 'Show comments', toggled: () => showComments, group: 'view' }),
    );
  },
};

/** A table a chart of the shown page reads: its connection and its name as `page.json`'s `table` gives it (`http_logs`, `logs.http_logs`). */
export interface PageTable {
  readonly connection: string;
  readonly table: string;
}

/** The tables the charts of `current` read, each once, in page order; none without a page. */
export function pageTables(current: PageJson | undefined): PageTable[] {
  const found = new Map<string, PageTable>();
  const walk = (nodes: readonly WidgetNode[]) => {
    for (const node of nodes) {
      if ('table' in node && node.table) {
        const connection = node.connection || 'default';
        found.set(`${connection}\u0000${node.table}`, { connection, table: node.table });
      }
      if ('children' in node && node.children) walk(Object.values(node.children));
    }
  };
  walk(current?.widgets ?? []);
  return [...found.values()];
}

/**
 * Of `schema`, the databases and tables `names` say (`page.json`'s short form: `<database>.<table>`, or `<table>` in
 * the connection's own database), in the schema's order; `missing`: the names it does not have.
 */
export function onlyTables(schema: Schema, names: readonly string[]): { schema: Schema; missing: string[] } {
  const wanted = new Map(
    names.map((name) => {
      const dot = name.indexOf('.');
      return [dot < 0 ? `${schema.database}.${name}` : name, name];
    }),
  );
  const databases = schema.databases
    .map((database) => ({ ...database, tables: database.tables.filter((table) => wanted.delete(`${database.name}.${table.name}`)) }))
    .filter((database) => database.tables.length > 0);
  return { schema: { ...schema, databases }, missing: [...wanted.values()] };
}

/**
 * "On this page" for `tables`: per connection, in `all`'s order (dashica_config's; a connection it does not name is
 * left out), a tree element connection › database › table, open down to the tables, filled once `schemas` answered;
 * a failed answer shows its error in place. A hint for a page whose charts read no table.
 */
export function drawPageTables(all: readonly string[], tables: readonly PageTable[], schemas: Schemas): HTMLElement[] {
  const shown = all.filter((name) => tables.some((table) => table.connection === name));
  if (shown.length === 0) return [html`<div class="d-schema__hint">No chart of this page reads a table.</div>`];
  return shown.map((name) => {
    const body: HTMLElement = html`<div class="d-schema__children"><span class="d-spinner"></span></div>`;
    const names = tables.filter((table) => table.connection === name).map((table) => table.table);
    schemas.get(name).then(
      (schema) => {
        const { schema: only, missing } = onlyTables(schema, names);
        body.replaceChildren(
          ...(only.databases.length > 0 ? drawDatabases(only, true) : []),
          ...missing.map((table) => html`<div class="d-schema__hint">${table}: not in the schema.</div>`),
        );
      },
      (error: unknown) => void body.replaceChildren(errorNotice(error)),
    );
    return html`<details class="d-schema__node" data-testid="schema-connection" open>
      <summary class="d-schema__summary">${createElement(Database, { width: 14, height: 14, 'aria-hidden': 'true' })}<span class="d-schema__name">${name}</span></summary>
      ${body}
    </details>`;
  });
}

/**
 * The tree element of the connection `name` in "All connections", closed; opened the first time it asks `schemas`
 * and shows its databases. `refresh` draws it again from `schemas` once it was opened, else nothing. A failed answer
 * shows its error in place; the next opening asks again.
 */
function connectionNode(name: string, schemas: Schemas): { element: HTMLDetailsElement; refresh(): Promise<void> } {
  const body: HTMLElement = html`<div class="d-schema__children"></div>`;
  const element: HTMLDetailsElement = html`<details class="d-schema__node" data-testid="schema-connection">
    <summary class="d-schema__summary">${createElement(Database, { width: 14, height: 14, 'aria-hidden': 'true' })}<span class="d-schema__name">${name}</span></summary>
    ${body}
  </details>`;
  /** Drawn (or drawing); `false` until it is opened, again after a failure. */
  let loaded = false;
  const load = () => {
    loaded = true;
    body.replaceChildren(html`<span class="d-spinner"></span>`);
    return schemas.get(name).then(
      (schema) => void body.replaceChildren(...drawDatabases(schema)),
      (error: unknown) => {
        loaded = false;
        body.replaceChildren(errorNotice(error));
      },
    );
  };
  element.addEventListener('toggle', () => {
    if (element.open && !loaded) void load();
  });
  return { element, refresh: () => (loaded ? load() : Promise.resolve()) };
}

/** A failed answer's text as an error notice. */
function errorNotice(error: unknown): HTMLElement {
  return html`<div class="d-notice d-notice--error">${error instanceof Error ? error.message : String(error)}</div>`;
}

/** A tree element per database of `schema`, closed unless `open`, its tables in it; a hint for a connection without any. */
export function drawDatabases(schema: Schema, open = false): HTMLElement[] {
  if (schema.databases.length === 0) return [html`<div class="d-schema__hint">No tables.</div>`];
  return schema.databases.map(
    (database) => html`<details class="d-schema__node" open=${open}>
      <summary class="d-schema__summary"><span class="d-schema__name">${database.name}</span><span class="d-schema__note">${database.tables.length}</span></summary>
      <div class="d-schema__children">${database.tables.map(drawTable)}</div>
    </details>`,
  );
}

/**
 * A closed tree element of `table`, as DataGrip shows a table: its columns (name, type, default, comment), then its
 * engine, ORDER BY, PARTITION BY, primary key, TTL and comment (each only when it has one), then its skip indices. The
 * comments (`d-schema__comment`, `d-schema__table-comment`) are what "Show comments" hides.
 */
export function drawTable(table: SchemaTable): HTMLElement {
  const keys: [string, string][] = [
    ['Engine', table.engine],
    ['ORDER BY', table.sortingKey],
    ['PARTITION BY', table.partitionKey],
    ['Primary key', table.primaryKey],
    ['TTL', table.ttl],
    ['Comment', table.comment],
  ];
  return html`<details class="d-schema__node" data-testid="schema-table">
    <summary class="d-schema__summary"><span class="d-schema__name">${table.name}</span><span class="d-schema__note">${table.engine}</span></summary>
    <div class="d-schema__table">
      <ul class="d-schema__columns" aria-label="Columns">
        ${table.columns.map(
          (column) => html`<li class="d-schema__column">
            <span class="d-schema__column-name">${column.name}</span>
            <span class="d-schema__type">${column.type}</span>
            ${column.defaultKind ? html`<span class="d-schema__default">${column.defaultKind} ${column.defaultExpression}</span>` : ''}
            ${column.comment ? html`<span class="d-schema__comment">${column.comment}</span>` : ''}
          </li>`,
        )}
      </ul>
      <dl class="d-schema__keys">
        ${keys
          .filter(([, value]) => value)
          .map(([key, value]) => {
            const comment = key === 'Comment' ? ' d-schema__table-comment' : '';
            // a fragment: html wraps two top-level nodes in a span, which would take one grid cell for both
            return html.fragment`<dt class=${`d-schema__key${comment}`}>${key}</dt><dd class=${`d-schema__value${comment}`}>${value}</dd>`;
          })}
      </dl>
      ${table.skipIndices.length === 0
        ? ''
        : html`<ul class="d-schema__indices" aria-label="Skip indices">
            ${table.skipIndices.map(
              (index) => html`<li class="d-schema__index">INDEX ${index.name} ${index.expression} TYPE ${index.type} GRANULARITY ${index.granularity}</li>`,
            )}
          </ul>`}
    </div>
  </details>`;
}
