import { html } from 'htl';
import type { Disposable } from '../../core/disposable/disposable';
import type { Extension } from '../../hosts/extension-host/extension-host';
import type { WidgetContext, WidgetOf } from '../../hosts/widgets/widgets';

/**
 * The widget type `speedscopeLink`: a button that opens the Speedscope flame graph viewer the widget's handler serves
 * (`<dataUrl>/viewer/`) in a new tab, on the profile its query gives with the page's time range, filter and params
 * (`<dataUrl>/speedscope-query`).
 */
export const speedscopeLink: Extension = {
  id: 'speedscopeLink',
  activate: ({ widgets, subscriptions }) => subscriptions.push(widgets.registerWidget('speedscopeLink', renderSpeedscopeLink)),
};

function renderSpeedscopeLink(el: HTMLElement, widget: WidgetOf<'speedscopeLink'>, ctx: WidgetContext): Disposable {
  const link: HTMLAnchorElement = html`<a target="_blank" class="btn btn-primary btn-sm">${widget.props.title || 'Open Speedscope'}</a>`;
  const showHref = () => {
    const origin = el.ownerDocument.location.origin;
    const profile = origin + ctx.url('/speedscope-query');
    link.href = `${origin}${widget.dataUrl}/viewer/#profileURL=${encodeURIComponent(profile)}`;
  };
  showHref();
  el.replaceChildren(html`<div class="my-4">${link}</div>`);
  // the time range, filter or a param changed
  return ctx.state.onDidRequestRefresh(showHref);
}
