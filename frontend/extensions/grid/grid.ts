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

function renderGrid(widgetContainer: HTMLElement, widget: WidgetOf<'grid'>, ctx: WidgetContext): Disposable {
  const template = widget.props.template ?? [];
  const layoutContainer = widgetContainer.ownerDocument.createElement('div');
  layoutContainer.className = 'd-grid';
  layoutContainer.style.gap = widget.props.gap ?? '';
  layoutContainer.style.gridTemplateColumns = `repeat(${template[0]?.trim().split(/\s+/).length ?? 1}, 1fr)`;
  layoutContainer.style.gridTemplateAreas = template.map((row) => JSON.stringify(row)).join(' ');
  const rendered: Disposable[] = [];
  for (const [name, child] of Object.entries(widget.children ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    const cellContainer = layoutContainer.appendChild(widgetContainer.ownerDocument.createElement('div'));
    cellContainer.style.gridArea = name;
    rendered.push(ctx.renderChild(cellContainer, child));
  }
  widgetContainer.replaceChildren(layoutContainer);
  return Disposable.from(...rendered);
}
