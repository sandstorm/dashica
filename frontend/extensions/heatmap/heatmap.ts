import * as Plot from '@observablehq/plot';
import type { TimeHeatmapOrdinalProps, TimeHeatmapProps } from '../../generated/zz_generated.dashica';
import type { Extension } from '../../hosts/extension-host/extension-host';
import type { QueryResult, WidgetContext, WidgetOf } from '../../hosts/widgets/widgets';
import { ChartFrame, type DrawOptions } from '../chart-library/chart-frame';
import { SchemaAnalyzer } from '../chart-library/schema';
import { filterOnClick } from '../chart-library/filter-on-click';
import { resolvedTimeRangeOf, timeAxisLabel, timeBucketTip } from '../chart-library/time-axis';
import { timeBrush } from '../chart-library/time-brush';
import { timeCursor } from '../chart-library/time-cursor';

/**
 * The widget types `timeHeatmap` and `timeHeatmapOrdinal`: a cell per time bucket (`x`) and `y` bucket, or per distinct
 * `y` value, colored by its measure (`fill`) in blues, inferno in dark mode. A click on a cell of an ordinal heatmap
 * shows the data point menu of its row (`y`, `filterOnClick`).
 */
export const heatmap: Extension = {
  id: 'heatmap',
  activate({ widgets, subscriptions }) {
    subscriptions.push(widgets.registerWidget('timeHeatmap', renderTimeHeatmap));
    subscriptions.push(widgets.registerWidget('timeHeatmapOrdinal', renderTimeHeatmapOrdinal));
  },
};

function renderTimeHeatmap(widgetContainer: HTMLElement, widget: WidgetOf<'timeHeatmap'>, ctx: WidgetContext): ChartFrame {
  const yBucketSize = widget.props.yBucketSize ?? 0;
  if (yBucketSize <= 0) throw new Error(`YBucketSize must be set to a positive value (was ${yBucketSize})`);
  return new ChartFrame(widgetContainer, ctx, {
    title: widget.props.title,
    height: widget.props.height,
    draw: (result, options) => drawTimeHeatmap(result, widget.props, yBucketSize, options),
  });
}

function renderTimeHeatmapOrdinal(widgetContainer: HTMLElement, widget: WidgetOf<'timeHeatmapOrdinal'>, ctx: WidgetContext): ChartFrame {
  return new ChartFrame(widgetContainer, ctx, {
    title: widget.props.title,
    height: widget.props.height,
    draw: (result, options) => drawTimeHeatmapOrdinal(result, widget.props, options, ctx),
  });
}

function drawTimeHeatmap(data: QueryResult, props: TimeHeatmapProps, yBucketSize: number, options: DrawOptions) {
  const schema = new SchemaAnalyzer(data);
  const x = String(schema.requiredColumn(props.x.alias, 'x'));
  const xBucketSize = props.x.xBucketSizeMs;
  if (!xBucketSize) {
    throw new Error('xBucketSize must be specified.');
  }
  const y = String(schema.requiredColumn(props.y.alias, 'y'));
  const fill = props.fill?.alias;
  const range = resolvedTimeRangeOf(data);

  return Plot.plot({
    height: props.height,
    width: options.width,
    marginLeft: props.marginLeft,
    x: {
      label: timeAxisLabel(props.x.alias, range),
      grid: false,
      axis: true,
      type: 'time',
    },
    y: {
      label: props.y.alias,
      grid: false,
      axis: true,
    },
    color: {
      scheme: options.colorSchemeDark ? 'inferno' : 'blues',
      legend: true,
    },
    marks: [
      Plot.rect(data, {
        x1: x,
        x2: (d: Record<string, number>) => d[x] + xBucketSize,
        y2: (d: Record<string, unknown>) => Number(d[y]),
        y1: (d: Record<string, unknown>) => Number(d[y]) - yBucketSize,
        // Clip to the frame: the last bucket's x2 extends one bucket past
        // the auto-fit domain and would otherwise paint outside the SVG.
        clip: true,
        tip: timeBucketTip(x, xBucketSize, props.x.alias),
        fill: fill ? (d: Record<string, unknown>) => Number(d[fill]) : undefined,
      }),
      timeCursor(options.timeCursor),
      timeBrush(options.onTimeSelect),
      Plot.ruleY([0]),
    ],
  });
}

/** A known bug: the cells are blues (inferno in dark mode) whatever `color` and `colorScheme` say. */
function drawTimeHeatmapOrdinal(data: QueryResult, props: TimeHeatmapOrdinalProps, options: DrawOptions, ctx: Pick<WidgetContext, 'showDataPointMenu'>) {
  const schema = new SchemaAnalyzer(data);
  const x = String(schema.requiredColumn(props.x.alias, 'x'));
  const xBucketSize = props.x.xBucketSizeMs;
  if (!xBucketSize) {
    throw new Error('xBucketSize must be specified.');
  }
  const cells: Plot.BarXOptions = {
    x: x,
    x2: (d: Record<string, number>) => d[x] + xBucketSize,
    y: schema.requiredColumn(props.y.alias, 'y'),
    // Clip to the frame: the last bucket's x2 extends one bucket past
    // the auto-fit domain and would otherwise paint outside the SVG.
    clip: true,
    fill: props.fill?.alias,
  };
  // the tip points by y, at the row under the mouse, and so does a click (FilterOnClickOptions.pointer)
  const pointer = 'y';
  const range = resolvedTimeRangeOf(data);

  return Plot.plot({
    height: props.height,
    width: options.width,
    marginLeft: props.marginLeft,
    x: {
      label: timeAxisLabel(props.x.alias, range),
      grid: false,
      axis: true,
      type: 'time',
    },
    y: {
      label: props.y.alias,
      grid: false,
      axis: true,
    },
    color: {
      scheme: options.colorSchemeDark ? 'inferno' : 'blues',
      legend: true,
    },
    marks: [
      Plot.barX(data, { ...cells, tip: { ...timeBucketTip(x, xBucketSize, props.x.alias), pointer } }),
      filterOnClick(Plot.barX, data, { ...cells, pointer, fields: [props.y], ctx }),
      timeCursor(options.timeCursor),
      timeBrush(options.onTimeSelect),
      Plot.ruleY([0]),
    ],
  });
}
