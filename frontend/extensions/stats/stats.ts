import { stats as drawStats } from '../../chart/stats';
import type { Extension } from '../../hosts/extension-host/extension-host';
import { ChartFrame, type WidgetContext, type WidgetOf } from '../../hosts/widgets/widgets';

/**
 * The widget type `stats`: one big number per result row (its `value` column) under its label (its `label` column, or
 * the `titleField`), drawn by `frontend/chart/stats.ts` in a chart frame.
 */
export const stats: Extension = {
  id: 'stats',
  activate: ({ widgets, subscriptions }) => subscriptions.push(widgets.registerWidget('stats', renderStats)),
};

function renderStats(el: HTMLElement, widget: WidgetOf<'stats'>, ctx: WidgetContext): ChartFrame {
  const chartProps = { title: widget.props.titleField?.alias, fill: widget.props.fillField?.alias };
  return new ChartFrame(el, ctx, {
    draw: (result) => drawStats(result, chartProps),
  });
}
