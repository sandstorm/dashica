import { html } from 'htl';
import { Disposable } from '../../core/disposable/disposable';
import type { Extension } from '../../hosts/extension-host/extension-host';
import type { WidgetOf } from '../../hosts/widgets/widgets';
import './schema-table.css';

/**
 * The widget type `schemaTable`: its title and the `CREATE TABLE` statement of its ClickHouse table, as the server
 * reads it (`<dataUrl>/schema`), to document the table a dashboard queries.
 */
export const schemaTable: Extension = {
  id: 'schemaTable',
  activate: ({ widgets, subscriptions }) => subscriptions.push(widgets.registerWidget('schemaTable', renderSchemaTable)),
};

function renderSchemaTable(widgetContainer: HTMLElement, widget: WidgetOf<'schemaTable'>): Disposable {
  const statementElement: HTMLElement = html`<pre class="d-schema-table__statement"></pre>`;
  const schemaTableElement: HTMLElement = html`<div class="d-schema-table">${statementElement}</div>`;
  if (widget.props.title) statementElement.before(html`<h2 class="d-schema-table__title">${widget.props.title}</h2>`);
  widgetContainer.replaceChildren(schemaTableElement);
  const controller = new AbortController();
  void drawStatement(statementElement, `${widget.dataUrl}/schema`, controller.signal);
  return new Disposable(() => controller.abort());
}

/** Puts what the server answers at `url` into `statementElement`, marked as an error when it is one. */
async function drawStatement(statementElement: HTMLElement, url: string, signal: AbortSignal): Promise<void> {
  try {
    const response = await fetch(url, { signal });
    statementElement.textContent = await response.text();
    if (!response.ok) statementElement.classList.add('d-schema-table__statement--error');
  } catch (error) {
    if (signal.aborted) return;
    statementElement.textContent = error instanceof Error ? error.message : String(error);
    statementElement.classList.add('d-schema-table__statement--error');
  }
}
