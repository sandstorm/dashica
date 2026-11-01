import * as Plot from '@observablehq/plot';
import type { BarHorizontalProps } from '../../generated/zz_generated.dashica';
import type { Commands } from '../../hosts/commands/commands';
import type { Extension } from '../../hosts/extension-host/extension-host';
import type { QueryResult, WidgetContext, WidgetOf } from '../../hosts/widgets/widgets';
import { ChartFrame, type DrawOptions } from '../chart-library/chart-frame';
import { filterOnClick } from '../chart-library/filter-on-click';
import { offerFiltersOf, type OfferFilters } from '../filter-library/offer';

/**
 * The widget type `barHorizontal`: a bar per category (`y`), from left to right as long as its measure (`x`). A click
 * on a bar offers its category and fill to filter by or exclude.
 */
export const barHorizontal: Extension = {
  id: 'barHorizontal',
  activate: ({ widgets, commands, subscriptions }) => subscriptions.push(widgets.registerWidget('barHorizontal', (el, widget, ctx) => renderBarHorizontal(el, widget, ctx, commands))),
};

function renderBarHorizontal(el: HTMLElement, widget: WidgetOf<'barHorizontal'>, ctx: WidgetContext, commands: Commands): ChartFrame {
  return new ChartFrame(el, ctx, {
    title: widget.props.title,
    height: widget.props.height,
    draw: (result, options) => drawBarHorizontal(result, widget.props, options, offerFiltersOf(commands, widget)),
  });
}

function drawBarHorizontal(data: QueryResult, props: BarHorizontalProps, options: DrawOptions, offerFilters: OfferFilters) {
  const bars: Plot.BarXOptions = { x: props.x.alias, y: props.y.alias, fill: props.fill?.alias ?? '#A8C1D1' };
  return Plot.plot({
    height: props.height,
    width: options.width,
    marginLeft: props.marginLeft,
    marginRight: props.marginRight,
    marginBottom: props.marginBottom,
    marginTop: props.marginTop,
    x: {
      label: props.x.alias,
      grid: true,
      axis: true,
    },
    y: {
      label: props.y.alias,
      grid: false,
      axis: true,
    },
    color: props.color ?? {
      legend: true,
    },
    marks: [
      Plot.barX(data, { ...bars, tip: true }),
      filterOnClick(Plot.barX, data, { ...bars, fields: [props.y, props.fill], offerFilters }),
    ],
  });
}
