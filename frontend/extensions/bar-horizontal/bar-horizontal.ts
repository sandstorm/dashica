import * as Plot from '@observablehq/plot';
import type { BarHorizontalProps } from '../../generated/zz_generated.dashica';
import type { Extension } from '../../hosts/extension-host/extension-host';
import { ChartFrame, type DrawOptions, type QueryResult, type WidgetContext, type WidgetOf } from '../../hosts/widgets/widgets';

/** The widget type `barHorizontal`: a bar per category (`y`), from left to right as long as its measure (`x`). */
export const barHorizontal: Extension = {
  id: 'barHorizontal',
  activate: ({ widgets, subscriptions }) => subscriptions.push(widgets.registerWidget('barHorizontal', renderBarHorizontal)),
};

function renderBarHorizontal(el: HTMLElement, widget: WidgetOf<'barHorizontal'>, ctx: WidgetContext): ChartFrame {
  return new ChartFrame(el, ctx, {
    title: widget.props.title,
    height: widget.props.height,
    draw: (result, options) => drawBarHorizontal(result, widget.props, options),
  });
}

/** `VIEW_LOGARITHMIC` makes y symlog: a bug the port keeps (docs/2026-10-28-workbench.md §5). */
function drawBarHorizontal(data: QueryResult, props: BarHorizontalProps, options: DrawOptions) {
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
      type: options.viewOptions.includes('VIEW_LOGARITHMIC') ? 'symlog' : undefined,
    },
    color: props.color ?? {
      legend: true,
    },
    marks: [
      Plot.barX(data, {
        x: props.x.alias,
        y: props.y.alias,
        tip: true,
        fill: props.fill?.alias ?? '#A8C1D1',
      }),
    ],
  });
}
