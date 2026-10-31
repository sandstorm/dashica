import * as Plot from '@observablehq/plot';
import type { TimeHeatmapOrdinalProps, TimeHeatmapProps } from '../../generated/zz_generated.dashica';
import type { Commands } from '../../hosts/commands/commands';
import type { Extension } from '../../hosts/extension-host/extension-host';
import type { QueryResult, WidgetContext, WidgetOf } from '../../hosts/widgets/widgets';
import { ChartFrame, type DrawOptions } from '../chart-library/chart-frame';
import { SchemaAnalyzer } from '../chart-library/schema';
import { filterOnClick, offerFiltersOf, type OfferFilters } from '../chart-library/filter-on-click';
import { timeBrush } from '../chart-library/time-brush';

/**
 * The widget types `timeHeatmap` and `timeHeatmapOrdinal`: a cell per time bucket (`x`) and `y` bucket, or per distinct
 * `y` value, colored by its measure (`fill`) in blues, inferno in dark mode. A click on a cell of an ordinal heatmap
 * offers its row (`y`) to filter by or exclude.
 */
export const heatmap: Extension = {
  id: 'heatmap',
  activate({ widgets, commands, subscriptions }) {
    subscriptions.push(widgets.registerWidget('timeHeatmap', renderTimeHeatmap));
    subscriptions.push(widgets.registerWidget('timeHeatmapOrdinal', (el, widget, ctx) => renderTimeHeatmapOrdinal(el, widget, ctx, commands)));
  },
};

function renderTimeHeatmap(el: HTMLElement, widget: WidgetOf<'timeHeatmap'>, ctx: WidgetContext): ChartFrame {
  const yBucketSize = widget.props.yBucketSize ?? 0;
  if (yBucketSize <= 0) throw new Error(`YBucketSize must be set to a positive value (was ${yBucketSize})`);
  return new ChartFrame(el, ctx, {
    title: widget.props.title,
    height: widget.props.height,
    draw: (result, options) => drawTimeHeatmap(result, widget.props, yBucketSize, options),
  });
}

function renderTimeHeatmapOrdinal(el: HTMLElement, widget: WidgetOf<'timeHeatmapOrdinal'>, ctx: WidgetContext, commands: Commands): ChartFrame {
  return new ChartFrame(el, ctx, {
    title: widget.props.title,
    height: widget.props.height,
    draw: (result, options) => drawTimeHeatmapOrdinal(result, widget.props, options, offerFiltersOf(commands, widget)),
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

  return Plot.plot({
    height: props.height,
    width: options.width,
    marginLeft: props.marginLeft,
    x: {
      label: props.x.alias,
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
        tip: true,
        fill: fill ? (d: Record<string, unknown>) => Number(d[fill]) : undefined,
      }),
      timeBrush(options.onTimeSelect),
      Plot.ruleY([0]),
    ],
  });
}

/** `color` and `colorScheme` are not used: a bug the port keeps (docs/2026-10-28-workbench.md §5). */
function drawTimeHeatmapOrdinal(data: QueryResult, props: TimeHeatmapOrdinalProps, options: DrawOptions, offerFilters: OfferFilters) {
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

  return Plot.plot({
    height: props.height,
    width: options.width,
    marginLeft: props.marginLeft,
    x: {
      label: props.x.alias,
      grid: false,
      axis: true,
      type: 'utc',
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
      Plot.barX(data, { ...cells, tip: true }),
      filterOnClick(Plot.barX, data, { ...cells, fields: [props.y], offerFilters }),
      timeBrush(options.onTimeSelect),
      Plot.ruleY([0]),
    ],
  });
}
