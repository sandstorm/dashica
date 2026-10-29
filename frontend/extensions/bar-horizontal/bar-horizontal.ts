import { barHorizontal as drawBarHorizontal } from '../../chart/barHorizontal';
import type { BarHorizontalProps } from '../../generated/zz_generated.dashica';
import type { Extension } from '../../hosts/extension-host/extension-host';
import { ChartFrame, type WidgetContext, type WidgetOf } from '../../hosts/widgets/widgets';

/**
 * The widget type `barHorizontal`: a bar per category (`y`) as long as its measure (`x`), drawn by
 * `frontend/chart/barHorizontal.ts` in a chart frame.
 */
export const barHorizontal: Extension = {
  id: 'barHorizontal',
  activate: ({ widgets, subscriptions }) => subscriptions.push(widgets.registerWidget('barHorizontal', renderBarHorizontal)),
};

function renderBarHorizontal(el: HTMLElement, widget: WidgetOf<'barHorizontal'>, ctx: WidgetContext): ChartFrame {
  const chartProps = barHorizontalChartProps(widget.props);
  return new ChartFrame(el, ctx, {
    title: widget.props.title,
    height: widget.props.height,
    draw: (result, options) => drawBarHorizontal(result, { ...chartProps, ...options }),
  });
}

/** What `frontend/chart/barHorizontal.ts` takes for its props: the fields as their column aliases. */
export function barHorizontalChartProps(props: BarHorizontalProps) {
  return {
    title: props.title,
    height: props.height,
    marginLeft: props.marginLeft,
    marginRight: props.marginRight,
    marginBottom: props.marginBottom,
    marginTop: props.marginTop,
    x: props.x.alias,
    y: props.y.alias,
    fill: props.fill?.alias,
    color: props.color,
  };
}
