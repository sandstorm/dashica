import { html } from 'htl';
import { Disposable } from '../../core/disposable/disposable';
import type { Extension } from '../../hosts/extension-host/extension-host';
import type { WidgetOf } from '../../hosts/widgets/widgets';

/**
 * The widget type `markdown`: its title and the HTML the server rendered from its markdown when the page was mounted
 * (goldmark with GitHub tables and highlighted code), styled as prose.
 */
export const markdown: Extension = {
  id: 'markdown',
  activate: ({ widgets, subscriptions }) => subscriptions.push(widgets.registerWidget('markdown', renderMarkdown)),
};

function renderMarkdown(el: HTMLElement, widget: WidgetOf<'markdown'>): Disposable {
  const body: HTMLElement = html`<div class="prose prose-slate dark:prose-invert max-w-none"></div>`;
  // the server rendered it: raw HTML passes for a compiled dashboard, is escaped for an untrusted one
  body.innerHTML = widget.props.html ?? '';
  const shown: HTMLElement = html`<div class="markdown-widget">${body}</div>`;
  if (widget.props.title) body.before(html`<h2 class="text-2xl font-bold mb-4">${widget.props.title}</h2>`);
  el.replaceChildren(shown);
  return new Disposable(() => {});
}
