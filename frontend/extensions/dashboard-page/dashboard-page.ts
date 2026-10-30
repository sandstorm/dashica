import { html } from 'htl';
import { Disposable } from '../../core/disposable/disposable';
import type { PageJson } from '../../generated/zz_generated.dashica';
import type { Extension } from '../../hosts/extension-host/extension-host';
import type { WidgetsApi } from '../../hosts/widgets/widgets';

/**
 * The page kind `dashboard`: a dashboard's widgets one below the other (a grid, a collapsible group, a chart), 24px
 * apart, each rendered by the extension of its widget type. Only markdown is prose; the rest keeps its own type sizes.
 */
export const dashboardPage: Extension = {
  id: 'dashboardPage',
  activate: ({ page, widgets, subscriptions }) =>
    subscriptions.push(page.registerPageRenderer('dashboard', (el, shown) => renderDashboard(el, shown, widgets))),
};

function renderDashboard(el: HTMLElement, page: PageJson, widgets: WidgetsApi): Disposable {
  const content: HTMLElement = html`<div class="flex flex-col gap-6 px-6 py-4"></div>`;
  const rendered = page.widgets.map((widget) => widgets.render(content.appendChild(el.ownerDocument.createElement('div')), widget));
  el.replaceChildren(content);
  return Disposable.from(...rendered);
}
