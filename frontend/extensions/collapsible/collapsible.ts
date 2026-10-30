import { html } from 'htl';
import { ChevronRight, createElement } from 'lucide';
import { Disposable } from '../../core/disposable/disposable';
import type { Extension } from '../../hosts/extension-host/extension-host';
import type { WidgetContext, WidgetOf } from '../../hosts/widgets/widgets';
import './collapsible.css';

/**
 * The widget type `collapsibleGroup`: its widgets one below the other under a title the viewer clicks to open or close
 * them; open at first when the group says so. A chart in a closed group queries once the group is opened. Flat, as a
 * row: a rule above, the title with a chevron (turned while open), the widgets 24px apart, no box around them.
 */
export const collapsible: Extension = {
  id: 'collapsible',
  activate: ({ widgets, subscriptions }) => subscriptions.push(widgets.registerWidget('collapsibleGroup', renderCollapsible)),
};

function renderCollapsible(el: HTMLElement, widget: WidgetOf<'collapsibleGroup'>, ctx: WidgetContext): Disposable {
  const content: HTMLElement = html`<div class="d-collapsible__content"></div>`;
  const group: HTMLDetailsElement = html`<details class="d-collapsible">
    <summary class="d-collapsible__title">
      ${createElement(ChevronRight, { width: 16, height: 16, class: 'd-collapsible__chevron' })}
      <span>${widget.props.title ?? ''}</span>
    </summary>
    ${content}
  </details>`;
  group.open = widget.props.open ?? false;
  const rendered: Disposable[] = [];
  for (const [, child] of Object.entries(widget.children ?? {}).sort(([a], [b]) => Number(a) - Number(b))) {
    rendered.push(ctx.renderChild(content.appendChild(el.ownerDocument.createElement('div')), child));
  }
  el.replaceChildren(group);
  return Disposable.from(...rendered);
}
