import type { Extension } from '../../hosts/extension-host/extension-host';
import type { WidgetContext, WidgetOf } from '../../hosts/widgets/widgets';
import { ChartFrame } from '../chart-library/chart-frame';
import { drawTimeBars } from '../chart-library/time-bars';

/**
 * The widget type `timeBar`: a bar per time bucket, drawn by `chart-library/time-bars.ts` in a chart frame. A click
 * on a bar shows the data point menu of its fill and facets (`filterOnClick`).
 */
export const timeBar: Extension = {
  id: 'timeBar',
  activate: ({ widgets, subscriptions }) => subscriptions.push(widgets.registerWidget('timeBar', renderTimeBar)),
};

function renderTimeBar(widgetContainer: HTMLElement, widget: WidgetOf<'timeBar'>, ctx: WidgetContext): ChartFrame {
  return new ChartFrame(widgetContainer, ctx, {
    title: widget.props.title,
    height: widget.props.height,
    draw: (result, options) => drawTimeBars(result, widget.props, options, { ctx }),
  });
}
