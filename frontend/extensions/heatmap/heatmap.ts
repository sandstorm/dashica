import { timeHeatmap as drawTimeHeatmap } from '../../chart/timeHeatmap';
import { timeHeatmapOrdinal as drawTimeHeatmapOrdinal } from '../../chart/timeHeatmapOrdinal';
import type { TimeHeatmapOrdinalProps, TimeHeatmapProps } from '../../generated/zz_generated.dashica';
import type { Extension } from '../../hosts/extension-host/extension-host';
import { ChartFrame, type WidgetContext, type WidgetOf } from '../../hosts/widgets/widgets';

/**
 * The widget types `timeHeatmap` and `timeHeatmapOrdinal`: a cell per time bucket (`x`) and `y` bucket, or per distinct
 * `y` value, colored by its measure (`fill`), drawn by `frontend/chart/timeHeatmap.ts` and
 * `frontend/chart/timeHeatmapOrdinal.ts` in a chart frame.
 */
export const heatmap: Extension = {
  id: 'heatmap',
  activate({ widgets, subscriptions }) {
    subscriptions.push(widgets.registerWidget('timeHeatmap', renderTimeHeatmap));
    subscriptions.push(widgets.registerWidget('timeHeatmapOrdinal', renderTimeHeatmapOrdinal));
  },
};

function renderTimeHeatmap(el: HTMLElement, widget: WidgetOf<'timeHeatmap'>, ctx: WidgetContext): ChartFrame {
  const chartProps = timeHeatmapChartProps(widget.props);
  return new ChartFrame(el, ctx, {
    title: widget.props.title,
    height: widget.props.height,
    draw: (result, options) => drawTimeHeatmap(result, { ...chartProps, ...options }),
  });
}

function renderTimeHeatmapOrdinal(el: HTMLElement, widget: WidgetOf<'timeHeatmapOrdinal'>, ctx: WidgetContext): ChartFrame {
  const chartProps = timeHeatmapOrdinalChartProps(widget.props);
  return new ChartFrame(el, ctx, {
    title: widget.props.title,
    height: widget.props.height,
    draw: (result, options) => drawTimeHeatmapOrdinal(result, { ...chartProps, ...options }),
  });
}

/** What `frontend/chart/timeHeatmap.ts` takes for its props: the fields as their column aliases; throws without a positive `yBucketSize`. */
export function timeHeatmapChartProps(props: TimeHeatmapProps) {
  const yBucketSize = props.yBucketSize ?? 0;
  if (yBucketSize <= 0) throw new Error(`YBucketSize must be set to a positive value (was ${yBucketSize})`);
  return {
    title: props.title,
    height: props.height,
    marginLeft: props.marginLeft,
    x: props.x.alias,
    // 0 for a time field without a bucket size: the chart then takes the server's (X-Dashica-Bucket-Size)
    xBucketSize: props.x.xBucketSizeMs ?? 0,
    y: props.y.alias,
    yBucketSize,
    fill: props.fill?.alias,
  };
}

/** What `frontend/chart/timeHeatmapOrdinal.ts` takes for its props: the fields as their column aliases; `colorScheme` as the color scale's scheme. */
export function timeHeatmapOrdinalChartProps(props: TimeHeatmapOrdinalProps) {
  return {
    title: props.title,
    height: props.height,
    marginLeft: props.marginLeft,
    x: props.x.alias,
    // 0 for a time field without a bucket size: the chart then takes the server's (X-Dashica-Bucket-Size)
    xBucketSize: props.x.xBucketSizeMs ?? 0,
    y: props.y.alias,
    yBucketSize: props.yBucketSize ?? 0,
    fill: props.fill?.alias,
    color: props.color ?? (props.colorScheme ? { scheme: props.colorScheme } : undefined),
  };
}
