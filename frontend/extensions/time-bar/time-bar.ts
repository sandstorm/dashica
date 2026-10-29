import { timeBar as drawTimeBar } from '../../chart/timeBar';
import type { TimeBarProps } from '../../generated/zz_generated.dashica';
import type { Extension } from '../../hosts/extension-host/extension-host';
import { ChartFrame, type WidgetContext, type WidgetOf } from '../../hosts/widgets/widgets';

/**
 * The widget type `timeBar`: a bar per time bucket (`x`) as high as its measure (`y`), stacked by `fill`, drawn by
 * `frontend/chart/timeBar.ts` in a chart frame.
 */
export const timeBar: Extension = {
  id: 'timeBar',
  activate: ({ widgets, subscriptions }) => subscriptions.push(widgets.registerWidget('timeBar', renderTimeBar)),
};

function renderTimeBar(el: HTMLElement, widget: WidgetOf<'timeBar'>, ctx: WidgetContext): ChartFrame {
  const chartProps = timeBarChartProps(widget.props);
  return new ChartFrame(el, ctx, {
    title: widget.props.title,
    height: widget.props.height,
    draw: (result, options) => drawTimeBar(result, { ...chartProps, ...options }),
  });
}

/** What `frontend/chart/timeBar.ts` takes for its props: the fields as their column aliases, the stack options flat. */
export function timeBarChartProps(props: TimeBarProps) {
  return {
    title: props.title,
    height: props.height,
    marginLeft: props.marginLeft,
    marginRight: props.marginRight,
    marginBottom: props.marginBottom,
    marginTop: props.marginTop,
    x: props.x.alias,
    // 0 for a time field without a bucket size: the chart then takes the server's (X-Dashica-Bucket-Size)
    xBucketSize: props.x.xBucketSizeMs ?? 0,
    y: props.y.alias,
    fill: props.fill?.alias,
    fx: props.fx?.alias,
    fy: props.fy?.alias,
    color: props.color,
    extraMarks: [],
    tip: props.tipChannels && Object.keys(props.tipChannels).length > 0 ? { channels: props.tipChannels } : undefined,
    order: props.stack?.order,
    offset: props.stack?.offset,
    reverse: props.stack?.reverse || undefined,
  };
}
