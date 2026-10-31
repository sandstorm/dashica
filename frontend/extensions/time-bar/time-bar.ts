import type { Commands } from '../../hosts/commands/commands';
import type { Extension } from '../../hosts/extension-host/extension-host';
import type { WidgetContext, WidgetOf } from '../../hosts/widgets/widgets';
import { ChartFrame } from '../chart-library/chart-frame';
import { offerFiltersOf } from '../chart-library/filter-on-click';
import { drawTimeBars } from '../chart-library/time-bars';

/**
 * The widget type `timeBar`: a bar per time bucket, drawn by `chart-library/time-bars.ts` in a chart frame. A click
 * on a bar offers its fill and facets to filter by or exclude.
 */
export const timeBar: Extension = {
  id: 'timeBar',
  activate: ({ widgets, commands, subscriptions }) => subscriptions.push(widgets.registerWidget('timeBar', (el, widget, ctx) => renderTimeBar(el, widget, ctx, commands))),
};

function renderTimeBar(el: HTMLElement, widget: WidgetOf<'timeBar'>, ctx: WidgetContext, commands: Commands): ChartFrame {
  return new ChartFrame(el, ctx, {
    title: widget.props.title,
    height: widget.props.height,
    draw: (result, options) => drawTimeBars(result, widget.props, options, offerFiltersOf(commands, widget)),
  });
}
