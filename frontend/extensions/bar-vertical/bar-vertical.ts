import * as Plot from '@observablehq/plot';
import type { Extension } from '../../hosts/extension-host/extension-host';
import type { QueryResult, WidgetContext, WidgetOf } from '../../hosts/widgets/widgets';
import { ChartFrame, type DrawOptions } from '../chart-library/chart-frame';
import { filterOnClick } from '../chart-library/filter-on-click';

/**
 * The widget type `barVertical`: a bar per category (`x`) as high as its measure (`y`), the categories sorted by it when
 * `sortReverse` is set; `fx` / `fy` split it into facets. A click on a bar shows the data point menu of its
 * `filterable` fields (`filterOnClick`).
 */
export const barVertical: Extension = {
  id: 'barVertical',
  activate: ({ widgets, subscriptions }) => subscriptions.push(widgets.registerWidget('barVertical', renderBarVertical)),
};

function renderBarVertical(widgetContainer: HTMLElement, widget: WidgetOf<'barVertical'>, ctx: WidgetContext): ChartFrame {
  return new ChartFrame(widgetContainer, ctx, {
    title: widget.props.title,
    height: widget.props.height,
    draw: (result, options) => drawBarVertical(result, widget, options, ctx),
  });
}

function drawBarVertical(data: QueryResult, widget: WidgetOf<'barVertical'>, options: DrawOptions, ctx: Pick<WidgetContext, 'showDataPointMenu'>) {
  const { props } = widget;
  const tipChannels = props.tipChannels && Object.keys(props.tipChannels).length > 0 ? props.tipChannels : undefined;
  // the tip points by x, at the bar under the mouse, and so does a click (FilterOnClickOptions.pointer)
  const pointer = 'x';
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
      axis: !props.fx, // with fx, the facets' axis is the axis
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
      Plot.barY(data, { ...bars, tip: tipChannels ? { pointer, channels: tipChannels } : pointer }),
      filterOnClick(Plot.barY, data, { ...bars, pointer, widget, ctx }),
    ],
  });
}
