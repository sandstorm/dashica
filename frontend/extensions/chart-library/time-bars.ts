import * as Plot from '@observablehq/plot';
import type { TimeBarProps } from '../../generated/zz_generated.dashica';
import type { QueryResult, WidgetContext } from '../../hosts/widgets/widgets';
import type { DrawOptions } from './chart-frame';
import { SchemaAnalyzer } from './schema';
import { filterOnClick } from './filter-on-click';
import { bucketSizeOf, resolvedTimeRangeOf } from './time-axis';
import { timeBrush } from './time-brush';

/**
 * A bar per time bucket (`x`) as high as its measure (`y`), stacked by `fill`, over the time range the server queried;
 * `thresholds` (an alert's, read by the alert chart) as red lines. The widget types `timeBar` and `alertDetail` draw
 * it. With `ctx`, a click on a bar shows the data point menu of its fill and facets (`filterOnClick`).
 *
 * The bucket size is the x field's, or the server's for an `AutoBucket` axis: the y axis then shows per second, since
 * a bucket size the server picks says nothing about the bars' height ("logs per 15 minutes or per 5?").
 */
export function drawTimeBars(
  data: QueryResult,
  props: TimeBarProps,
  options: DrawOptions,
  { ctx, thresholds = [] }: { readonly ctx?: Pick<WidgetContext, 'showDataPointMenu'>; readonly thresholds?: readonly number[] } = {},
) {
  const schema = new SchemaAnalyzer(data);
  const x = String(schema.requiredColumn(props.x.alias, 'x'));
  const serverBucketSize = bucketSizeOf(data);
  const xBucketSize = serverBucketSize ?? props.x.xBucketSizeMs;
  if (!xBucketSize) {
    throw new Error('xBucketSize must be specified, or auto-bucketing must be activated via -- BUCKET: ... in the SQL query.');
  }
  const perSecond = serverBucketSize != null ? (value: number) => (value / xBucketSize) * 1000 : undefined;
  const range = resolvedTimeRangeOf(data);
  const buckets = range ? Math.floor((range.to - range.from) / xBucketSize) : undefined;
  const tipChannels = props.tipChannels && Object.keys(props.tipChannels).length > 0 ? props.tipChannels : undefined;
  // the tip points by x, at the bucket under the mouse, and so does a click (FilterOnClickOptions.pointer)
  const pointer = 'x';
  const bars: Plot.RectYOptions = {
    x1: x,
    x2: (d: Record<string, number>) => d[x] + xBucketSize,
    y: schema.requiredColumn(props.y.alias, 'y'),
    fx: props.fx?.alias,
    fy: props.fy?.alias,
    order: props.stack?.order,
    offset: props.stack?.offset,
    reverse: props.stack?.reverse,
    marginRight: 150,
    // clipped to the frame: Plot draws a mark past it otherwise, a bucket wider than the domain onto the page
    clip: true,
    fill: props.fill?.alias ?? '#A8C1D1',
    // a bit of padding between the bars, when they are wide enough - HEURISTIC
    insetLeft: buckets === undefined || props.fx ? 0 : buckets * 2 < options.width ? 1 : 0,
  };

  return Plot.plot({
    height: props.height,
    width: options.width,
    marginLeft: props.marginLeft,
    marginRight: props.marginRight,
    marginBottom: props.marginBottom,
    marginTop: props.marginTop,
    x: {
      label: props.x.alias,
      grid: false,
      axis: true,
      type: 'time',
      domain: range ? [range.from, range.to] : undefined,
    },
    y: {
      label: props.y.alias + (perSecond ? ' / s' : ''),
      grid: true,
      axis: true,
      transform: perSecond,
    },
    color: props.color ?? {
      legend: true,
    },
    marks: [
      Plot.rectY(data, { ...bars, tip: tipChannels ? { pointer, channels: tipChannels } : pointer }),
      ctx ? filterOnClick(Plot.rectY, data, { ...bars, pointer, fields: [props.fill, props.fx, props.fy], ctx }) : null,
      timeBrush(options.onTimeSelect),
      Plot.ruleY([0]),
      thresholds.length > 0 ? Plot.ruleY(thresholds, { stroke: 'red', strokeWidth: 2 }) : null,
    ],
  });
}
