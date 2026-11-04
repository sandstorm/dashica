import type { Extension } from '../../hosts/extension-host/extension-host';
import type { WidgetContext, WidgetOf } from '../../hosts/widgets/widgets';
import { ChartFrame } from '../chart-library/chart-frame';
import { FlameGraphView } from './flame-graph-view';
import './flame-graph.css';

/**
 * The widget type `flameGraph`: a profile (the Continuous Profiling dashboards' Excimer stacks) as a flame graph, root
 * at the top, from its query's rows of `stack` (frames root first, separated by ";") and `value` (samples). A click on
 * a frame zooms to it, its ancestors full width above; the search dims the frames whose name it does not match and
 * tells their share; the table below lists the functions by self or total samples, a click on one searches for it.
 * It sits in the chart frame as every chart does, so it queries with the page's time range, filters and params.
 */
export const flameGraph: Extension = {
  id: 'flameGraph',
  activate: ({ widgets, subscriptions }) => subscriptions.push(widgets.registerWidget('flameGraph', renderFlameGraph)),
};

const DEFAULT_HEIGHT = 500;

function renderFlameGraph(widgetContainer: HTMLElement, widget: WidgetOf<'flameGraph'>, ctx: WidgetContext): ChartFrame {
  const view = new FlameGraphView(widget.props.height || DEFAULT_HEIGHT);
  return new ChartFrame(widgetContainer, ctx, {
    title: widget.props.title,
    draw: (result, { width, colorSchemeDark }) => view.draw(result, width, colorSchemeDark),
  });
}
