import { html } from 'htl';
import { Disposable } from '../../core/disposable/disposable';
import type { Extension } from '../../hosts/extension-host/extension-host';
import { showWidgetError } from '../../hosts/widgets/widgets';

/**
 * The widget type `markdown`: its title and the HTML the server renders from its markdown (`<dataUrl>/html`, goldmark
 * with GitHub tables and highlighted code), styled as prose.
 */
export function markdown(): Extension {
  return {
    id: 'markdown',
    activate({ widgets, subscriptions }) {
      subscriptions.push(
        widgets.registerWidget('markdown', {
          render(el, widget) {
            const body: HTMLElement = html`<div class="prose prose-slate dark:prose-invert max-w-none"></div>`;
            el.replaceChildren(html`<div class="markdown-widget">
              ${widget.props.title ? html`<h2 class="text-2xl font-bold mb-4">${widget.props.title}</h2>` : ''}
              ${body}
            </div>`);
            const controller = new AbortController();
            fetch(`${widget.dataUrl}/html`, { signal: controller.signal })
              .then(async (response) => {
                const text = await response.text();
                if (!response.ok) throw new Error(text);
                body.innerHTML = text;
              })
              .catch((error: unknown) => {
                if (!controller.signal.aborted) showWidgetError(el, error, widget);
              });
            return new Disposable(() => controller.abort());
          },
        }),
      );
    },
  };
}
