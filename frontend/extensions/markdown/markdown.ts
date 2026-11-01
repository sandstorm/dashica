import { html } from 'htl';
import { Disposable } from '../../core/disposable/disposable';
import type { Extension } from '../../hosts/extension-host/extension-host';
import type { WidgetOf } from '../../hosts/widgets/widgets';
import './markdown.css';

/**
 * The widget type `markdown`: its title and the HTML the server rendered from its markdown when the page was mounted
 * (goldmark with GitHub tables and highlighted code), styled by markdown.css (14px, as the charts around it).
 */
export const markdown: Extension = {
  id: 'markdown',
  activate: ({ widgets, subscriptions }) => subscriptions.push(widgets.registerWidget('markdown', renderMarkdown)),
};

function renderMarkdown(widgetContainer: HTMLElement, widget: WidgetOf<'markdown'>): Disposable {
  const bodyContainer: HTMLElement = html`<div class="d-markdown__body"></div>`;
  // the server rendered it: raw HTML passes for a compiled dashboard, is escaped for an untrusted one
  bodyContainer.innerHTML = widget.props.html ?? '';
  const markdownElement: HTMLElement = html`<div class="d-markdown">${bodyContainer}</div>`;
  if (widget.props.title) bodyContainer.before(html`<h2 class="d-markdown__title">${widget.props.title}</h2>`);
  widgetContainer.replaceChildren(markdownElement);
  return new Disposable(() => {});
}
