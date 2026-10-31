import { html } from 'htl';
import { Database, RefreshCw, createElement } from 'lucide';
import type { PageJson, Schema, SchemaTable, WidgetNode } from '../../generated/zz_generated.dashica';
import type { Extension } from '../../hosts/extension-host/extension-host';
import './schema.css';

/**
 * The left side panel "Schema", only with Explore enabled (`workbench.json`'s `explore`: it is part of Explore,
 * Perspective concept §4.8): a tree connection › database › table of the ClickHouse connections of dashica_config
 * (`workbench.json`'s `connections`), the shown page's connections (its charts' `connection`) first, the others below.
 * A connection's databases are asked from `/schema.json` when it is opened the first time; a table opens to what
 * DataGrip shows of one: its columns (type, default, comment), engine, ORDER BY, PARTITION BY, primary key, TTL and
 * skip indices. The server keeps each connection's schema; "Refresh" in the panel's "…" asks it again for the
 * connections opened so far. A tree element stays as the viewer left it (open or closed) when another page is shown.
 */
export const schema: Extension = {
  id: 'schema',
  activate({ ui, page, commands, subscriptions }) {
    if (!page.workbench.explore) return;
    const panel = ui.registerSidePanel('schema', { label: 'Schema', icon: createElement(Database).outerHTML, order: 30 });
    const connections = new Map(page.workbench.connections.map((name) => [name, connectionNode(name)]));
    const draw = () => {
      const { shown, others } = orderConnections(page.workbench.connections, pageConnections(page.current));
      const group = (label: string, names: readonly string[]) =>
        names.length === 0 ? '' : html`<div class="d-schema__group">${label}</div>${names.map((name) => connections.get(name)!.element)}`;
      panel.body.replaceChildren(html`<div class="d-schema">
        ${group('On this page', shown)}${group(shown.length === 0 ? 'Connections' : 'Other connections', others)}
      </div>`);
    };
    draw();
    subscriptions.push(
      panel,
      page.onDidChangePage(draw),
      commands.registerCommand('schema.refresh', () => Promise.all([...connections.values()].map((connection) => connection.refresh()))),
      ui.registerMenuItem('panel/schema', { command: 'schema.refresh', title: 'Refresh', icon: createElement(RefreshCw).outerHTML }),
    );
  },
};

/** The connections the charts of `current` run on, each once, in page order; none without a page. */
export function pageConnections(current: PageJson | undefined): string[] {
  const found = new Set<string>();
  const walk = (nodes: readonly WidgetNode[]) => {
    for (const node of nodes) {
      if ('connection' in node && node.connection) found.add(node.connection);
      if ('children' in node && node.children) walk(Object.values(node.children));
    }
  };
  walk(current?.widgets ?? []);
  return [...found];
}

/** `all` (dashica_config's, sorted) split into those `onPage` names, in `all`'s order, and the others. */
export function orderConnections(all: readonly string[], onPage: readonly string[]): { shown: string[]; others: string[] } {
  return { shown: all.filter((name) => onPage.includes(name)), others: all.filter((name) => !onPage.includes(name)) };
}

/** What `/schema.json` answers for `connection`; `refresh`: the server asks ClickHouse again. A failed answer throws its text. */
export async function fetchSchema(connection: string, refresh = false): Promise<Schema> {
  const response = await fetch(`/schema.json?${new URLSearchParams({ connection, ...(refresh ? { refresh: '1' } : {}) })}`);
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
}

/**
 * The tree element of the connection `name`, closed; opened the first time it asks its schema and shows its
 * databases. `refresh` asks it again (the server too) once it was asked, else nothing. A failed answer shows its error
 * in place; the next opening asks again.
 */
function connectionNode(name: string): { element: HTMLDetailsElement; refresh(): Promise<void> } {
  const body: HTMLElement = html`<div class="d-schema__children"></div>`;
  const element: HTMLDetailsElement = html`<details class="d-schema__node" data-testid="schema-connection">
    <summary class="d-schema__summary">${createElement(Database, { width: 14, height: 14, 'aria-hidden': 'true' })}<span class="d-schema__name">${name}</span></summary>
    ${body}
  </details>`;
  /** Asked once (or asking); `undefined` until it is opened, again after a failure. */
  let asked: Promise<void> | undefined;
  const load = (refresh: boolean) => {
    body.replaceChildren(html`<span class="d-spinner"></span>`);
    asked = fetchSchema(name, refresh).then(
      (schema) => void body.replaceChildren(...drawDatabases(schema)),
      (error: unknown) => {
        asked = undefined;
        body.replaceChildren(html`<div class="d-notice d-notice--error">${error instanceof Error ? error.message : String(error)}</div>`);
      },
    );
    return asked;
  };
  element.addEventListener('toggle', () => {
    if (element.open && !asked) void load(false);
  });
  return { element, refresh: () => (asked ? load(true) : Promise.resolve()) };
}

/** A closed tree element per database of `schema`, its tables in it; a hint for a connection without any. */
export function drawDatabases(schema: Schema): HTMLElement[] {
  if (schema.databases.length === 0) return [html`<div class="d-schema__hint">No tables.</div>`];
  return schema.databases.map(
    (database) => html`<details class="d-schema__node">
      <summary class="d-schema__summary"><span class="d-schema__name">${database.name}</span><span class="d-schema__note">${database.tables.length}</span></summary>
      <div class="d-schema__children">${database.tables.map(drawTable)}</div>
    </details>`,
  );
}

/**
 * A closed tree element of `table`, as DataGrip shows a table: its columns (name, type, default, comment), then its
 * engine, ORDER BY, PARTITION BY, primary key, TTL and comment (each only when it has one), then its skip indices.
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
        ${keys.filter(([, value]) => value).map(([key, value]) => html`<dt class="d-schema__key">${key}</dt><dd class="d-schema__value">${value}</dd>`)}
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
