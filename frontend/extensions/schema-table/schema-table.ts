import { html } from 'htl';
import { Disposable } from '../../core/disposable/disposable';
import type { Extension } from '../../hosts/extension-host/extension-host';

/**
 * The widget type `schemaTable`: its title and the `CREATE TABLE` statement of its ClickHouse table, as the server
 * reads it (`<dataUrl>/schema`), to document the table a dashboard queries.
 */
export function schemaTable(): Extension {
  return {
    id: 'schemaTable',
    activate({ widgets, subscriptions }) {
      subscriptions.push(
        widgets.registerWidget('schemaTable', {
          render(el, widget) {
            const statement: HTMLElement = html`<pre class="text-xs overflow-x-auto p-3 bg-base-200 rounded"></pre>`;
            el.replaceChildren(html`<div class="markdown-widget">
              ${widget.props.title ? html`<h2 class="text-2xl font-bold mb-4">${widget.props.title}</h2>` : ''}
              ${statement}
            </div>`);
            const controller = new AbortController();
            fetch(`${widget.dataUrl}/schema`, { signal: controller.signal })
              .then(async (response) => {
                statement.textContent = await response.text();
                if (!response.ok) statement.classList.add('text-error');
              })
              .catch((error: unknown) => {
                if (controller.signal.aborted) return;
                statement.textContent = error instanceof Error ? error.message : String(error);
                statement.classList.add('text-error');
              });
            return new Disposable(() => controller.abort());
          },
        }),
      );
    },
  };
}
