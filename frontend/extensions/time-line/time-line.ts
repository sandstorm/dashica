import { timeLine as drawTimeLine } from '../../chart/timeLine';
import type { TimeLineProps } from '../../generated/zz_generated.dashica';
import type { Extension } from '../../hosts/extension-host/extension-host';
import { ChartFrame, type WidgetContext, type WidgetOf } from '../../hosts/widgets/widgets';

/**
 * The widget type `timeLine`: a line over time (`x`) through its measure (`y`), one line per `strokeField` value,
 * drawn by `frontend/chart/timeLine.ts` in a chart frame.
 */
export const timeLine: Extension = {
  id: 'timeLine',
  activate: ({ widgets, subscriptions }) => subscriptions.push(widgets.registerWidget('timeLine', renderTimeLine)),
};

function renderTimeLine(el: HTMLElement, widget: WidgetOf<'timeLine'>, ctx: WidgetContext): ChartFrame {
  const chartProps = timeLineChartProps(widget.props);
  return new ChartFrame(el, ctx, {
    title: widget.props.title,
    height: widget.props.height,
    draw: (result, options) => drawTimeLine(result, { ...chartProps, ...options }),
  });
}

/** What `frontend/chart/timeLine.ts` takes for its props: the fields as their column aliases; `stroke` the field, else the color. */
export function timeLineChartProps(props: TimeLineProps) {
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
    stroke: props.strokeField?.alias ?? (props.stroke || undefined),
    z: props.zField?.alias,
    fx: props.fx?.alias,
    fy: props.fy?.alias,
    color: props.color,
    tip: props.tipChannels && Object.keys(props.tipChannels).length > 0 ? { channels: props.tipChannels } : undefined,
  };
}
