import { Disposable } from '../../core/disposable/disposable';
import type { Extension } from '../../hosts/extension-host/extension-host';
import { ChartFrame, type WidgetContext, type WidgetOf } from '../../hosts/widgets/widgets';
import { drawTable } from '../chart-library/table';

/**
 * The widget type `table`: the result rows (Tabulator) with a search box, filters per column, sticky tooltips that can
 * be pinned, and a details panel for the selected rows. A cell's menu adds its value to the page's SQL filter.
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
    draw: (result) => drawTable(result, widget.props),
  });
  return Disposable.from(frame, new Disposable(() => el.removeEventListener('dashica-add-filter', addFilter)));
}

