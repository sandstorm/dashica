import * as Plot from '@observablehq/plot';
import type { BarHorizontalProps } from '../../generated/zz_generated.dashica';
import type { Extension } from '../../hosts/extension-host/extension-host';
import type { QueryResult, WidgetContext, WidgetOf } from '../../hosts/widgets/widgets';
import { ChartFrame, type DrawOptions } from '../chart-library/chart-frame';
import { filterOnClick } from '../chart-library/filter-on-click';

/**
 * The widget type `barHorizontal`: a bar per category (`y`), from left to right as long as its measure (`x`). A click
 * on a bar shows the data point menu of its category and fill (`filterOnClick`).
 */
export const barHorizontal: Extension = {
  id: 'barHorizontal',
  activate: ({ widgets, subscriptions }) => subscriptions.push(widgets.registerWidget('barHorizontal', renderBarHorizontal)),
};

function renderBarHorizontal(widgetContainer: HTMLElement, widget: WidgetOf<'barHorizontal'>, ctx: WidgetContext): ChartFrame {
  return new ChartFrame(widgetContainer, ctx, {
    title: widget.props.title,
    height: widget.props.height,
    draw: (result, options) => drawBarHorizontal(result, widget.props, options, ctx),
  });
}

function drawBarHorizontal(data: QueryResult, props: BarHorizontalProps, options: DrawOptions, ctx: Pick<WidgetContext, 'showDataPointMenu'>) {
  const bars: Plot.BarXOptions = { x: props.x.alias, y: props.y.alias, fill: props.fill?.alias ?? '#A8C1D1' };
  // the tip points by y, at the bar under the mouse, and so does a click (FilterOnClickOptions.pointer)
  const pointer = 'y';
  return Plot.plot({
    height: props.height,
    width: options.width,
    marginLeft: props.marginLeft,
    marginRight: props.marginRight,
    marginBottom: props.marginBottom,
    marginTop: props.marginTop,
    x: {
      label: props.x.alias,
      grid: true,
      axis: true,
    },
    y: {
      label: props.y.alias,
      grid: false,
      axis: true,
    },
    color: props.color ?? {
      legend: true,
    },
    marks: [
      Plot.barX(data, { ...bars, tip: pointer }),
      filterOnClick(Plot.barX, data, { ...bars, pointer, fields: [props.y, props.fill], ctx }),
    ],
  });
}
