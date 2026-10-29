import { html } from 'htl';
import { Disposable } from '../../core/disposable/disposable';
import type { Extension } from '../../hosts/extension-host/extension-host';
import type { WidgetOf } from '../../hosts/widgets/widgets';

/**
 * The widget type `schemaTable`: its title and the `CREATE TABLE` statement of its ClickHouse table, as the server
 * reads it (`<dataUrl>/schema`), to document the table a dashboard queries.
 */
export const schemaTable: Extension = {
  id: 'schemaTable',
  activate: ({ widgets, subscriptions }) => subscriptions.push(widgets.registerWidget('schemaTable', renderSchemaTable)),
};

function renderSchemaTable(el: HTMLElement, widget: WidgetOf<'schemaTable'>): Disposable {
  const statement: HTMLElement = html`<pre class="text-xs overflow-x-auto p-3 bg-base-200 rounded"></pre>`;
  const shown: HTMLElement = html`<div class="markdown-widget">${statement}</div>`;
  if (widget.props.title) statement.before(html`<h2 class="text-2xl font-bold mb-4">${widget.props.title}</h2>`);
  el.replaceChildren(shown);
  const controller = new AbortController();
  void showStatement(statement, `${widget.dataUrl}/schema`, controller.signal);
  return new Disposable(() => controller.abort());
}

/** Puts what the server answers at `url` into `statement`, marked as an error when it is one. */
async function showStatement(statement: HTMLElement, url: string, signal: AbortSignal): Promise<void> {
  try {
    const response = await fetch(url, { signal });
    statement.textContent = await response.text();
    if (!response.ok) statement.classList.add('text-error');
  } catch (error) {
    if (signal.aborted) return;
    statement.textContent = error instanceof Error ? error.message : String(error);
    statement.classList.add('text-error');
  }
}
