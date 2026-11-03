import * as Plot from '@observablehq/plot';
import type { Extension } from '../../hosts/extension-host/extension-host';
import type { QueryResult, WidgetContext, WidgetOf } from '../../hosts/widgets/widgets';
import { ChartFrame, type DrawOptions } from '../chart-library/chart-frame';
import { SchemaAnalyzer } from '../chart-library/schema';
import { filterOnClick } from '../chart-library/filter-on-click';
import { bucketSizeOf, formatTipTime, resolvedTimeRangeOf, TIP_LINE_WIDTH, timeAxisLabel } from '../chart-library/time-axis';
import { timeBrush } from '../chart-library/time-brush';
import { timeCursor } from '../chart-library/time-cursor';

/**
 * The widget type `timeLine`: a line over time (`x`) through its measure (`y`), over the time range the server queried;
 * a line per value of `strokeField` (or of `zField`, in one color), else one in the color `stroke`. A click on a line
 * shows the data point menu of its `filterable` fields (`filterOnClick`).
 */
export const timeLine: Extension = {
  id: 'timeLine',
  activate: ({ widgets, subscriptions }) => subscriptions.push(widgets.registerWidget('timeLine', renderTimeLine)),
};

function renderTimeLine(widgetContainer: HTMLElement, widget: WidgetOf<'timeLine'>, ctx: WidgetContext): ChartFrame {
  return new ChartFrame(widgetContainer, ctx, {
    title: widget.props.title,
    height: widget.props.height,
    draw: (result, options) => drawTimeLine(result, widget, options, ctx),
  });
}

function drawTimeLine(data: QueryResult, widget: WidgetOf<'timeLine'>, options: DrawOptions, ctx: Pick<WidgetContext, 'showDataPointMenu'>) {
  const { props } = widget;
  const schema = new SchemaAnalyzer(data);
  if (!(bucketSizeOf(data) ?? props.x.xBucketSizeMs)) {
    throw new Error('xBucketSize must be specified, or auto-bucketing must be activated via -- BUCKET: ... in the SQL query.');
  }
  const range = resolvedTimeRangeOf(data);
  // the tip points at the closest point, and so does a click (FilterOnClickOptions.pointer)
  const pointer = 'xy';
  const tip: Plot.TipOptions & { pointer: typeof pointer } = {
    pointer,
    channels: props.tipChannels,
    format: { x: formatTipTime },
    lineWidth: TIP_LINE_WIDTH,
  };
  const lines: Plot.LineOptions = {
    x: schema.requiredColumn(props.x.alias, 'x'),
    y: schema.requiredColumn(props.y.alias, 'y'),
    z: props.zField?.alias,
    fx: props.fx?.alias,
    fy: props.fy?.alias,
    marginRight: 150,
    stroke: props.strokeField?.alias ?? (props.stroke || '#4682B4'),
    // The first bucket start (e.g. toStartOfHour) can round below the
    // domain start, so the line's first point plots left of the frame
    // and bleeds over the y-axis. Clip crops it to the frame.
    clip: true,
  };

  return Plot.plot({
    height: props.height,
    width: options.width,
    marginLeft: props.marginLeft,
    marginRight: props.marginRight,
    marginBottom: props.marginBottom,
    marginTop: props.marginTop,
    x: {
      label: timeAxisLabel(props.x.alias, range),
      grid: false,
      axis: true,
      type: 'time',
      domain: range ? [range.from, range.to] : undefined,
    },
    y: {
      // An AutoBucket axis shows the values as they are (the time bars
      // show them per second): lines usually show rates or ratios already.
      label: props.y.alias,
      grid: true,
      axis: true,
    },
    color: props.color ?? {
      legend: true,
    },
    marks: [
      Plot.line(data, { ...lines, tip }),
      filterOnClick(Plot.line, data, { ...lines, pointer, widget, ctx }),
      timeCursor(options.timeCursor),
      timeBrush(options.onTimeSelect),
      Plot.ruleY([0]),
    ],
  });
}
