import { html } from 'htl';
import { Disposable } from '../../core/disposable/disposable';
import type { Extension } from '../../hosts/extension-host/extension-host';

/**
 * The widget type `collapsibleGroup`: its widgets one below the other under a title the viewer clicks to open or close
 * them; open at first when the group says so. A chart in a closed group queries once the group is opened.
 */
export function collapsible(): Extension {
  return {
    id: 'collapsible',
    activate({ widgets, subscriptions }) {
      subscriptions.push(
        widgets.registerWidget('collapsibleGroup', {
          render(el, widget, ctx) {
            const content: HTMLElement = html`<div class="collapse-content text-sm"></div>`;
            const group: HTMLDetailsElement = html`<details class="collapse collapse-arrow border-base-300 border">
              <summary class="collapse-title font-semibold">${widget.props.title ?? ''}</summary>
              ${content}
            </details>`;
            group.open = widget.props.open ?? false;
            const children = Object.entries(widget.children ?? {}).sort(([a], [b]) => Number(a) - Number(b));
            const rendered = children.map(([, child]) => ctx.renderChild(content.appendChild(el.ownerDocument.createElement('div')), child));
            el.replaceChildren(group);
            return Disposable.from(...rendered);
          },
        }),
      );
    },
  };
}
