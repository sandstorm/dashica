import type { Commands } from '../../hosts/commands/commands';
import type { Extension } from '../../hosts/extension-host/extension-host';
import type { WidgetContext, WidgetOf } from '../../hosts/widgets/widgets';
import { ChartFrame } from '../chart-library/chart-frame';
import { offerFiltersOf } from '../filter-library/offer';
import { drawTimeBars } from '../chart-library/time-bars';

/**
 * The widget type `timeBar`: a bar per time bucket, drawn by `chart-library/time-bars.ts` in a chart frame. A click
 * on a bar offers its fill and facets to filter by or exclude.
 */
export const timeBar: Extension = {
  id: 'timeBar',
  activate: ({ widgets, commands, subscriptions }) => subscriptions.push(widgets.registerWidget('timeBar', (widgetContainer, widget, ctx) => renderTimeBar(widgetContainer, widget, ctx, commands))),
};

function renderTimeBar(widgetContainer: HTMLElement, widget: WidgetOf<'timeBar'>, ctx: WidgetContext, commands: Commands): ChartFrame {
  return new ChartFrame(widgetContainer, ctx, {
    title: widget.props.title,
    height: widget.props.height,
    draw: (result, options) => drawTimeBars(result, widget.props, options, { offerFilters: offerFiltersOf(commands, widget) }),
  });
}
