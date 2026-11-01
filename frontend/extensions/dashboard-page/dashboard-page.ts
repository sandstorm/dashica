import { html } from 'htl';
import { Disposable } from '../../core/disposable/disposable';
import type { PageJson } from '../../generated/zz_generated.dashica';
import type { Extension } from '../../hosts/extension-host/extension-host';
import type { PageContext } from '../../hosts/page/page';
import type { WidgetsApi } from '../../hosts/widgets/widgets';
import { PARAMS } from '../widget-library/params-state';
import './dashboard-page.css';

/**
 * The page kind `dashboard`: a dashboard's widgets one below the other (a grid, a collapsible group, a chart), 24px
 * apart, each rendered by the extension of its widget type. Only markdown is prose; the rest keeps its own type sizes.
 * A link to a chart (`/p/shop#w=3`, the id in its `dataUrl`) opens the groups around it, scrolls it into view and
 * highlights it for a moment: once rendered, and on each change of its tab's hash. The widgets query with the tab's
 * query state, which holds the dashboard's params (`PARAMS`, declared here, `?wp=…`), the values of its form widgets:
 * sent on every page, also one without form widgets.
 */
export const dashboardPage: Extension = {
  id: 'dashboardPage',
  activate: ({ page, query, widgets, subscriptions }) =>
    subscriptions.push(
      query.declare(PARAMS),
      page.registerPageRenderer('dashboard', (pageContainer, shown, context) => renderDashboard(pageContainer, shown, context, widgets)),
    ),
};

function renderDashboard(pageContainer: HTMLElement, page: PageJson, context: PageContext, widgets: WidgetsApi): Disposable {
  const contentContainer: HTMLElement = html`<div class="d-dashboard-page"></div>`;
  const rendered = page.widgets.map((widget) => widgets.render(contentContainer.appendChild(pageContainer.ownerDocument.createElement('div')), widget, context.query));
  pageContainer.replaceChildren(contentContainer);
  const reveal = () => revealLinked(contentContainer, context.hash);
  reveal();
  return Disposable.from(...rendered, context.onDidChangeHash(reveal));
}

function revealLinked(contentContainer: HTMLElement, hash: string): void {
  const id = new URLSearchParams(hash.slice(1)).get('w');
  if (!id) return;
  const widgetElement = [...contentContainer.querySelectorAll<HTMLElement>('[data-data-url]')].find((candidateElement) => candidateElement.dataset.dataUrl!.split('/').pop() === id);
  if (!widgetElement) return;
  for (let groupElement = widgetElement.closest('details'); groupElement; groupElement = groupElement.parentElement?.closest('details') ?? null) groupElement.open = true;
  widgetElement.scrollIntoView({ block: 'center' });
  // again from the start when the same chart is linked twice
  widgetElement.classList.remove(LINKED);
  void widgetElement.offsetWidth;
  widgetElement.classList.add(LINKED);
  const onAnimationEnd = (event: AnimationEvent) => {
    if (event.animationName !== LINKED_ANIMATION) return;
    widgetElement.classList.remove(LINKED);
    widgetElement.removeEventListener('animationend', onAnimationEnd);
  };
  widgetElement.addEventListener('animationend', onAnimationEnd);
}

const LINKED = 'd-dashboard-page__linked';
/** The animation of `LINKED` in dashboard-page.css; one inside the chart ends its own. */
const LINKED_ANIMATION = 'd-dashboard-page-linked';
