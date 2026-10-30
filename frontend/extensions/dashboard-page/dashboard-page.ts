import { html } from 'htl';
import { Disposable } from '../../core/disposable/disposable';
import type { PageJson } from '../../generated/zz_generated.dashica';
import type { Extension } from '../../hosts/extension-host/extension-host';
import type { WidgetsApi } from '../../hosts/widgets/widgets';
import './dashboard-page.css';

/**
 * The page kind `dashboard`: a dashboard's widgets one below the other (a grid, a collapsible group, a chart), 24px
 * apart, each rendered by the extension of its widget type. Only markdown is prose; the rest keeps its own type sizes.
 * A link to a chart (`/p/shop#w=3`, the id in its `dataUrl`) opens the groups around it, scrolls it into view and
 * highlights it for a moment: once rendered, and on each `hashchange` while shown.
 */
export const dashboardPage: Extension = {
  id: 'dashboardPage',
  activate: ({ page, widgets, subscriptions }) =>
    subscriptions.push(page.registerPageRenderer('dashboard', (el, shown) => renderDashboard(el, shown, widgets))),
};

function renderDashboard(el: HTMLElement, page: PageJson, widgets: WidgetsApi): Disposable {
  const content: HTMLElement = html`<div class="d-dashboard-page"></div>`;
  const rendered = page.widgets.map((widget) => widgets.render(content.appendChild(el.ownerDocument.createElement('div')), widget));
  el.replaceChildren(content);
  const browserWindow = el.ownerDocument.defaultView!;
  const onHashChange = () => revealLinked(content, browserWindow.location.hash);
  onHashChange();
  browserWindow.addEventListener('hashchange', onHashChange);
  return Disposable.from(...rendered, new Disposable(() => browserWindow.removeEventListener('hashchange', onHashChange)));
}

/** Opens the groups around the widget `hash` names (`#w=3`), scrolls it into view and highlights it. */
function revealLinked(content: HTMLElement, hash: string): void {
  const id = new URLSearchParams(hash.slice(1)).get('w');
  if (!id) return;
  const widget = [...content.querySelectorAll<HTMLElement>('[data-data-url]')].find((candidate) => candidate.dataset.dataUrl!.split('/').pop() === id);
  if (!widget) return;
  for (let group = widget.closest('details'); group; group = group.parentElement?.closest('details') ?? null) group.open = true;
  widget.scrollIntoView({ block: 'center' });
  // again from the start when the same chart is linked twice
  widget.classList.remove(LINKED);
  void widget.offsetWidth;
  widget.classList.add(LINKED);
  const onAnimationEnd = (event: AnimationEvent) => {
    if (event.animationName !== LINKED_ANIMATION) return;
    widget.classList.remove(LINKED);
    widget.removeEventListener('animationend', onAnimationEnd);
  };
  widget.addEventListener('animationend', onAnimationEnd);
}

const LINKED = 'd-dashboard-page__linked';
/** The animation of `LINKED` in dashboard-page.css; one inside the chart ends its own. */
const LINKED_ANIMATION = 'd-dashboard-page-linked';
