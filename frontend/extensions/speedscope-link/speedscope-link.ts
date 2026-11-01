import { html } from 'htl';
import { Disposable } from '../../core/disposable/disposable';
import type { Extension } from '../../hosts/extension-host/extension-host';
import type { PageApi } from '../../hosts/page/page';
import type { WidgetContext, WidgetOf } from '../../hosts/widgets/widgets';
import './speedscope-link.css';

/**
 * The widget type `speedscopeLink`: a button that opens the Speedscope flame graph viewer the widget's handler serves
 * (`<dataUrl>/viewer/`) in a new tab of the workbench (`page.popOut`, the viewer in an iframe), on the profile its
 * query gives with the page's time range, filter and params then (`<dataUrl>/speedscope-query`). The button is a link
 * to the viewer, so a click with a modifier key or the middle button opens it in a browser tab.
 */
export const speedscopeLink: Extension = {
  id: 'speedscopeLink',
  activate: ({ widgets, page, subscriptions }) =>
    subscriptions.push(widgets.registerWidget('speedscopeLink', (widgetContainer, widget, ctx) => renderSpeedscopeLink(widgetContainer, widget, ctx, page))),
};

function renderSpeedscopeLink(widgetContainer: HTMLElement, widget: WidgetOf<'speedscopeLink'>, ctx: WidgetContext, page: Pick<PageApi, 'popOut'>): Disposable {
  const open = (event: MouseEvent) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const src = linkElement.href;
    void page.popOut({
      title: 'Speedscope',
      // the tab's element is emptied when it closes
      render: (tabContainer) => (tabContainer.append(html`<iframe class="d-speedscope-tab" title="Speedscope" src=${src}></iframe>`), Disposable.from()),
    });
  };
  const linkElement: HTMLAnchorElement = html`<a target="_blank" class="d-button d-button--primary" onclick=${open}>${widget.props.title || 'Open Speedscope'}</a>`;
  const showHref = () => {
    const origin = widgetContainer.ownerDocument.location.origin;
    const profile = origin + ctx.url('/speedscope-query');
    linkElement.href = `${origin}${widget.dataUrl}/viewer/#profileURL=${encodeURIComponent(profile)}`;
  };
  showHref();
  widgetContainer.replaceChildren(html`<div>${linkElement}</div>`);
  // the time range, filter or a param changed
  return ctx.query.onDidRequestRefresh(showHref);
}
