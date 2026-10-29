import { table as drawTable } from '../../chart/table';
import { Disposable } from '../../core/disposable/disposable';
import type { Extension } from '../../hosts/extension-host/extension-host';
import { ChartFrame, type WidgetContext, type WidgetOf } from '../../hosts/widgets/widgets';

/**
 * The widget type `table`: the result rows with a search box, filters per column and a details panel for the selected
 * rows, drawn by `frontend/chart/table.ts` in a chart frame. A cell's menu adds its value to the page's SQL filter.
 */
export const table: Extension = {
  id: 'table',
  activate: ({ widgets, subscriptions }) => subscriptions.push(widgets.registerWidget('table', renderTable)),
};

function renderTable(el: HTMLElement, widget: WidgetOf<'table'>, ctx: WidgetContext): Disposable {
  // a cell's "Filter: …" sends its condition up from the cell
  const addFilter = (event: Event) => ctx.state.filters.add((event as CustomEvent<string>).detail);
  el.addEventListener('dashica-add-filter', addFilter);
  const frame = new ChartFrame(el, ctx, {
    title: widget.props.title,
    height: widget.props.height,
    draw: (result, options) => drawTable(result, { title: widget.props.title, height: widget.props.height, ...options }),
  });
  return Disposable.from(frame, new Disposable(() => el.removeEventListener('dashica-add-filter', addFilter)));
}
