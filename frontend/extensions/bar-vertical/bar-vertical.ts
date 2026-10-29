import { barVertical as drawBarVertical } from '../../chart/barVertical';
import type { BarVerticalProps } from '../../generated/zz_generated.dashica';
import type { Extension } from '../../hosts/extension-host/extension-host';
import { ChartFrame, type WidgetContext, type WidgetOf } from '../../hosts/widgets/widgets';

/**
 * The widget type `barVertical`: a bar per category (`x`) as high as its measure (`y`), drawn by
 * `frontend/chart/barVertical.ts` in a chart frame.
 */
export const barVertical: Extension = {
  id: 'barVertical',
  activate: ({ widgets, subscriptions }) => subscriptions.push(widgets.registerWidget('barVertical', renderBarVertical)),
};

function renderBarVertical(el: HTMLElement, widget: WidgetOf<'barVertical'>, ctx: WidgetContext): ChartFrame {
  const chartProps = barVerticalChartProps(widget.props);
  return new ChartFrame(el, ctx, {
    title: widget.props.title,
    height: widget.props.height,
    draw: (result, options) => drawBarVertical(result, { ...chartProps, ...options }),
  });
}

/** What `frontend/chart/barVertical.ts` takes for its props: the fields as their column aliases; `sortReverse` as a sort by y. */
export function barVerticalChartProps(props: BarVerticalProps) {
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
    fx: props.fx?.alias,
    fy: props.fy?.alias,
    color: props.color,
    sort: props.sortReverse === undefined ? undefined : { x: 'y', reverse: props.sortReverse },
    tip: props.tipChannels && Object.keys(props.tipChannels).length > 0 ? { channels: props.tipChannels } : undefined,
  };
}
