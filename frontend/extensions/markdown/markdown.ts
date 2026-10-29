import { html } from 'htl';
import { Disposable } from '../../core/disposable/disposable';
import type { Extension } from '../../hosts/extension-host/extension-host';
import { showWidgetError, type WidgetOf } from '../../hosts/widgets/widgets';

/**
 * The widget type `markdown`: its title and the HTML the server renders from its markdown (`<dataUrl>/html`, goldmark
 * with GitHub tables and highlighted code), styled as prose.
 */
export const markdown: Extension = {
  id: 'markdown',
  activate: ({ widgets, subscriptions }) => subscriptions.push(widgets.registerWidget('markdown', renderMarkdown)),
};

function renderMarkdown(el: HTMLElement, widget: WidgetOf<'markdown'>): Disposable {
  const body: HTMLElement = html`<div class="prose prose-slate dark:prose-invert max-w-none"></div>`;
  const shown: HTMLElement = html`<div class="markdown-widget">${body}</div>`;
  if (widget.props.title) body.before(html`<h2 class="text-2xl font-bold mb-4">${widget.props.title}</h2>`);
  el.replaceChildren(shown);
  const controller = new AbortController();
  void showHtml(el, body, widget, controller.signal);
  return new Disposable(() => controller.abort());
}

/** Puts the server's HTML into `body`, or its error in place of the widget in `el`. */
async function showHtml(el: HTMLElement, body: HTMLElement, widget: WidgetOf<'markdown'>, signal: AbortSignal): Promise<void> {
  try {
    const response = await fetch(`${widget.dataUrl}/html`, { signal });
    const text = await response.text();
    if (!response.ok) throw new Error(text);
    body.innerHTML = text;
  } catch (error) {
    if (!signal.aborted) showWidgetError(el, error, widget);
  }
}
