import * as Plot from '@observablehq/plot';
import type { TimeBarProps } from '../../generated/zz_generated.dashica';
import type { DrawOptions, QueryResult } from '../../hosts/widgets/widgets';
import { SchemaAnalyzer } from './schema';
import { timeBrush } from './time-brush';

/**
 * A bar per time bucket (`x`) as high as its measure (`y`), stacked by `fill`, over the time range the server queried;
 * an alert's thresholds (`X-Dashica-Alert-If`) as red lines. The widget types `timeBar` and `alertDetail` draw it.
 *
 * The bucket size is the x field's, or the server's for an `AutoBucket` axis: the y axis then shows per second, since
 * a bucket size the server picks says nothing about the bars' height ("logs per 15 minutes or per 5?").
 */
export function drawTimeBars(data: QueryResult, props: TimeBarProps, options: DrawOptions) {
  const schema = new SchemaAnalyzer(data);
  const x = String(schema.requiredColumn(props.x.alias, 'x'));
  const xBucketSize = data.dashicaBucketSize ?? props.x.xBucketSizeMs;
  if (!xBucketSize) {
    throw new Error('xBucketSize must be specified, or auto-bucketing must be activated via -- BUCKET: ... in the SQL query.');
  }
  const perSecond = data.dashicaBucketSize != null ? (value: number) => (value / xBucketSize) * 1000 : undefined;
  const range = data.dashicaResolvedTimeRange;
  const buckets = range ? Math.floor((range.to - range.from) / xBucketSize) : undefined;
  const tipChannels = props.tipChannels && Object.keys(props.tipChannels).length > 0 ? props.tipChannels : undefined;
  const alertIf = data.dashicaAlertIf;

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
      Plot.rectY(data, {
        x1: x,
        x2: (d: Record<string, number>) => d[x] + xBucketSize,
        y: schema.requiredColumn(props.y.alias, 'y'),
        fx: props.fx?.alias,
        fy: props.fy?.alias,
        order: props.stack?.order,
        offset: props.stack?.offset,
        reverse: props.stack?.reverse,
        marginRight: 150,
        // Observable Plot does not clip marks to the frame by default, so a
        // bucket wider than the domain paints outside the SVG onto the page.
        clip: true,
        tip: tipChannels ? { channels: tipChannels } : true,
        fill: props.fill?.alias ?? '#A8C1D1',
        // a bit of padding between the bars, when they are wide enough - HEURISTIC
        insetLeft: buckets === undefined || props.fx ? 0 : buckets * 2 < options.width ? 1 : 0,
      }),
      timeBrush(options.onTimeSelect),
      Plot.ruleY([0]),
      // Alert threshold lines from X-Dashica-Alert-If header
      alertIf?.value_gt ? Plot.ruleY([alertIf.value_gt], { stroke: 'red', strokeWidth: 2 }) : null,
      alertIf?.value_lt ? Plot.ruleY([alertIf.value_lt], { stroke: 'red', strokeWidth: 2 }) : null,
    ],
  });
}
