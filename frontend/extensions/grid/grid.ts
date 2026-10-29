import { Disposable } from '../../core/disposable/disposable';
import type { Extension } from '../../hosts/extension-host/extension-host';

/**
 * The widget type `grid`: its areas laid out as its template draws them (`["a b", "c c"]`: a and b side by side, c
 * below across both), each area's widget rendered into its cell.
 */
export function grid(): Extension {
  return {
    id: 'grid',
    activate({ widgets, subscriptions }) {
      subscriptions.push(
        widgets.registerWidget('grid', (el, widget, ctx) => {
            const template = widget.props.template ?? [];
            const layout = el.ownerDocument.createElement('div');
            layout.style.display = 'grid';
            layout.style.gap = widget.props.gap ?? '';
            layout.style.gridTemplateColumns = `repeat(${template[0]?.trim().split(/\s+/).length ?? 1}, 1fr)`;
            layout.style.gridTemplateAreas = template.map((row) => JSON.stringify(row)).join(' ');
            const areas = Object.entries(widget.children ?? {}).sort(([a], [b]) => a.localeCompare(b));
            const rendered = areas.map(([name, child]) => {
              const cell = layout.appendChild(el.ownerDocument.createElement('div'));
              cell.style.gridArea = name;
              return ctx.renderChild(cell, child);
            });
            el.replaceChildren(layout);
            return Disposable.from(...rendered);
        }),
      );
    },
  };
}
