import * as Plot from '@observablehq/plot';
import type { BarVerticalProps } from '../../generated/zz_generated.dashica';
import type { Extension } from '../../hosts/extension-host/extension-host';
import { ChartFrame, type DrawOptions, type QueryResult, type WidgetContext, type WidgetOf } from '../../hosts/widgets/widgets';
import { filterOnClick } from '../chart-library/filter-on-click';

/**
 * The widget type `barVertical`: a bar per category (`x`) as high as its measure (`y`), the categories sorted by it when
 * `sortReverse` is set; `fx` / `fy` split it into facets. A click on a bar offers its category, fill and facets to
 * filter by or exclude.
 */
export const barVertical: Extension = {
  id: 'barVertical',
  activate: ({ widgets, subscriptions }) => subscriptions.push(widgets.registerWidget('barVertical', renderBarVertical)),
};

function renderBarVertical(el: HTMLElement, widget: WidgetOf<'barVertical'>, ctx: WidgetContext): ChartFrame {
  return new ChartFrame(el, ctx, {
    title: widget.props.title,
    height: widget.props.height,
    draw: (result, options) => drawBarVertical(result, widget.props, options, (at, candidates) => ctx.offerFilters(at, candidates)),
  });
}

function drawBarVertical(data: QueryResult, props: BarVerticalProps, options: DrawOptions, offerFilters: WidgetContext['offerFilters']) {
  const tipChannels = props.tipChannels && Object.keys(props.tipChannels).length > 0 ? props.tipChannels : undefined;
  const bars: Plot.BarYOptions = {
    x: props.x.alias,
    y: props.y.alias,
    fx: props.fx?.alias,
    fy: props.fy?.alias,
    sort: props.sortReverse === undefined ? undefined : { x: 'y', reverse: props.sortReverse },
    fill: props.fill?.alias ?? (props.fx ? props.x.alias : '#A8C1D1'),
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
      axis: !props.fx, // do not show the axis if fx is configured (because this will be the axis instead)
      tickRotate: -30,
    },
    y: {
      label: props.y.alias,
      grid: true,
      axis: true,
    },
    color: props.color ?? {
      legend: true,
    },
    marks: [
      Plot.barY(data, { ...bars, tip: tipChannels ? { channels: tipChannels } : true }),
      filterOnClick(Plot.barY, data, { ...bars, fields: [props.x, props.fill, props.fx, props.fy], offerFilters }),
    ],
  });
}
