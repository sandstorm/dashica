import type { Extension } from '../../hosts/extension-host/extension-host';
import { ChartFrame, type WidgetContext, type WidgetOf } from '../../hosts/widgets/widgets';
import { drawTimeBars } from '../chart-library/time-bars';

/** The widget type `timeBar`: a bar per time bucket, drawn by `chart-library/time-bars.ts` in a chart frame. */
export const timeBar: Extension = {
  id: 'timeBar',
  activate: ({ widgets, subscriptions }) => subscriptions.push(widgets.registerWidget('timeBar', renderTimeBar)),
};

function renderTimeBar(el: HTMLElement, widget: WidgetOf<'timeBar'>, ctx: WidgetContext): ChartFrame {
  return new ChartFrame(el, ctx, {
    title: widget.props.title,
    height: widget.props.height,
    draw: (result, options) => drawTimeBars(result, widget.props, options),
  });
}
