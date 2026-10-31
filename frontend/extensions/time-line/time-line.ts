import * as Plot from '@observablehq/plot';
import type { TimeLineProps } from '../../generated/zz_generated.dashica';
import type { Commands } from '../../hosts/commands/commands';
import type { Extension } from '../../hosts/extension-host/extension-host';
import { ChartFrame, type DrawOptions, type QueryResult, type WidgetContext, type WidgetOf } from '../../hosts/widgets/widgets';
import { SchemaAnalyzer } from '../chart-library/schema';
import { filterOnClick, offerFiltersOf, type OfferFilters } from '../chart-library/filter-on-click';
import { timeBrush } from '../chart-library/time-brush';

/**
 * The widget type `timeLine`: a line over time (`x`) through its measure (`y`), over the time range the server queried;
 * a line per value of `strokeField` (or of `zField`, in one color), else one in the color `stroke`. A click on a line
 * offers its `zField`, `strokeField` and facets to filter by or exclude.
 */
export const timeLine: Extension = {
  id: 'timeLine',
  activate: ({ widgets, commands, subscriptions }) => subscriptions.push(widgets.registerWidget('timeLine', (el, widget, ctx) => renderTimeLine(el, widget, ctx, commands))),
};

function renderTimeLine(el: HTMLElement, widget: WidgetOf<'timeLine'>, ctx: WidgetContext, commands: Commands): ChartFrame {
  return new ChartFrame(el, ctx, {
    title: widget.props.title,
    height: widget.props.height,
    draw: (result, options) => drawTimeLine(result, widget.props, options, offerFiltersOf(commands, widget)),
  });
}

function drawTimeLine(data: QueryResult, props: TimeLineProps, options: DrawOptions, offerFilters: OfferFilters) {
  const schema = new SchemaAnalyzer(data);
  if (!(data.dashicaBucketSize ?? props.x.xBucketSizeMs)) {
    throw new Error('xBucketSize must be specified, or auto-bucketing must be activated via -- BUCKET: ... in the SQL query.');
  }
  const range = data.dashicaResolvedTimeRange;
  const tipChannels = props.tipChannels && Object.keys(props.tipChannels).length > 0 ? props.tipChannels : undefined;
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
      label: props.x.alias,
      grid: false,
      axis: true,
      type: 'time',
      domain: range ? [range.from, range.to] : undefined,
    },
    y: {
      // Unlike the time bars, an AutoBucket axis is not normalized to /s:
      // lines usually show rates or ratios already.
      label: props.y.alias,
      grid: true,
      axis: true,
    },
    color: props.color ?? {
      legend: true,
    },
    marks: [
      Plot.line(data, { ...lines, tip: tipChannels ? { channels: tipChannels } : true }),
      filterOnClick(Plot.line, data, { ...lines, fields: [props.zField, props.strokeField, props.fx, props.fy], offerFilters }),
      timeBrush(options.onTimeSelect),
      Plot.ruleY([0]),
    ],
  });
}
