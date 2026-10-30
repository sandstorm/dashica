import { html } from 'htl';
import { ChevronRight, createElement } from 'lucide';
import { Disposable } from '../../core/disposable/disposable';
import type { Extension } from '../../hosts/extension-host/extension-host';
import type { WidgetContext, WidgetOf } from '../../hosts/widgets/widgets';

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
  const content: HTMLElement = html`<div class="flex flex-col gap-6 pt-2 pb-2"></div>`;
  const group: HTMLDetailsElement = html`<details class="group border-t border-base-300">
    <summary class="flex cursor-pointer list-none items-center gap-1.5 py-2 text-sm font-semibold select-none"
      >${createElement(ChevronRight, { class: 'w-4 h-4 opacity-60 transition-transform group-open:rotate-90' })}<span
        >${widget.props.title ?? ''}</span
      ></summary>
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
