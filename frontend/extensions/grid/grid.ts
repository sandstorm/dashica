import { Disposable } from '../../core/disposable/disposable';
import type { Extension } from '../../hosts/extension-host/extension-host';
import type { WidgetContext, WidgetOf } from '../../hosts/widgets/widgets';
import './grid.css';

/**
 * The widget type `grid`: its areas laid out as its template draws them (`["a b", "c c"]`: a and b side by side, c
 * below across both), each area's widget rendered into its cell; 16px apart unless the grid sets its `gap`.
 */
export const grid: Extension = {
  id: 'grid',
  activate: ({ widgets, subscriptions }) => subscriptions.push(widgets.registerWidget('grid', renderGrid)),
};

function renderGrid(el: HTMLElement, widget: WidgetOf<'grid'>, ctx: WidgetContext): Disposable {
  const template = widget.props.template ?? [];
  const layout = el.ownerDocument.createElement('div');
  layout.className = 'd-grid';
  layout.style.gap = widget.props.gap ?? '';
  layout.style.gridTemplateColumns = `repeat(${template[0]?.trim().split(/\s+/).length ?? 1}, 1fr)`;
  layout.style.gridTemplateAreas = template.map((row) => JSON.stringify(row)).join(' ');
  const rendered: Disposable[] = [];
  for (const [name, child] of Object.entries(widget.children ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    const cell = layout.appendChild(el.ownerDocument.createElement('div'));
    cell.style.gridArea = name;
    rendered.push(ctx.renderChild(cell, child));
  }
  el.replaceChildren(layout);
  return Disposable.from(...rendered);
}
