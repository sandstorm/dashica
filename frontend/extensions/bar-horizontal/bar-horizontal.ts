import * as Plot from '@observablehq/plot';
import type { BarHorizontalProps } from '../../generated/zz_generated.dashica';
import type { Extension } from '../../hosts/extension-host/extension-host';
import { ChartFrame, type DrawOptions, type QueryResult, type WidgetContext, type WidgetOf } from '../../hosts/widgets/widgets';
import { selectOnClick } from '../chart-library/select-on-click';

/**
 * The widget type `barHorizontal`: a bar per category (`y`), from left to right as long as its measure (`x`). A click
 * on a bar offers its category and fill to select.
 */
export const barHorizontal: Extension = {
  id: 'barHorizontal',
  activate: ({ widgets, subscriptions }) => subscriptions.push(widgets.registerWidget('barHorizontal', renderBarHorizontal)),
};

function renderBarHorizontal(el: HTMLElement, widget: WidgetOf<'barHorizontal'>, ctx: WidgetContext): ChartFrame {
  return new ChartFrame(el, ctx, {
    title: widget.props.title,
    height: widget.props.height,
    draw: (result, options) => drawBarHorizontal(result, widget.props, options, (at, candidates) => ctx.choose(at, candidates)),
  });
}

function drawBarHorizontal(data: QueryResult, props: BarHorizontalProps, options: DrawOptions, choose: WidgetContext['choose']) {
  const bars: Plot.BarXOptions = { x: props.x.alias, y: props.y.alias, fill: props.fill?.alias ?? '#A8C1D1' };
  return Plot.plot({
    title: props.title,
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
      Plot.barX(data, { ...bars, tip: true }),
      selectOnClick(Plot.barX, data, { ...bars, fields: [props.y, props.fill], choose }),
    ],
  });
}
