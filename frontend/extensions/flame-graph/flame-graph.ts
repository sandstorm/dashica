import { Disposable } from '../../core/disposable/disposable';
import type { Extension } from '../../hosts/extension-host/extension-host';
import type { WidgetContext, WidgetOf } from '../../hosts/widgets/widgets';
import { ChartFrame } from '../chart-library/chart-frame';
import { FRAME_MENU, FlameGraphView, type FrameMenuContext } from './flame-graph-view';
import './flame-graph.css';

/**
 * The widget type `flameGraph`: a profile (the Continuous Profiling dashboards' Excimer stacks) as a flame graph, root
 * at the top, from its query's rows of `stack` (frames root first, separated by ";") and `value` (samples). A click on
 * a frame zooms to it, its path from the root above, clickable; Ctrl/⌘ + scroll, a pinch, the zoom buttons and + − 0
 * zoom around the pointer, a drag and ← → pan, Esc goes a step back. The search dims the frames it does not match and
 * tells their share; a right click on a frame shows the menu `flameGraph/frame` (zoom, search, copy its name or stack).
 * The table lists the functions by self or total samples, a click on one searches for it. A button puts it into full screen. It sits in the chart frame, so it
 * queries with the page's time range, filters and params.
 */
export const flameGraph: Extension = {
  id: 'flameGraph',
  activate: ({ widgets, commands, ui, subscriptions }) => {
    subscriptions.push(widgets.registerWidget('flameGraph', renderFlameGraph));
    for (const entry of FRAME_MENU_ENTRIES) {
      subscriptions.push(
        commands.registerCommand(entry.command, entry.run),
        ui.registerMenuItem<FrameMenuContext>(FRAME_MENU, { command: entry.command, title: entry.title, group: entry.group, order: entry.order }),
      );
    }
  },
};

/** The entries of a frame's menu: zoom to it, search for its function, copy either. */
const FRAME_MENU_ENTRIES: readonly { command: string; title: string; group: string; order: number; run: (frame: FrameMenuContext) => unknown }[] = [
  { command: 'flameGraph.zoomToFrame', title: 'Zoom to frame', group: 'navigation', order: 0, run: (frame) => frame.zoom() },
  { command: 'flameGraph.searchFunction', title: 'Search for this function', group: 'navigation', order: 1, run: (frame) => frame.search() },
  { command: 'flameGraph.copyName', title: 'Copy function name', group: 'copy', order: 0, run: (frame) => navigator.clipboard.writeText(frame.name) },
  { command: 'flameGraph.copyStack', title: 'Copy stack (root first)', group: 'copy', order: 1, run: (frame) => navigator.clipboard.writeText(frame.stack) },
];

const DEFAULT_HEIGHT = 800;

function renderFlameGraph(widgetContainer: HTMLElement, widget: WidgetOf<'flameGraph'>, ctx: WidgetContext): Disposable {
  const view = new FlameGraphView(widget.props.height || DEFAULT_HEIGHT, (anchor, frame) => ctx.showMenu(FRAME_MENU, anchor, frame));
  const frame = new ChartFrame(widgetContainer, ctx, {
    title: widget.props.title,
    draw: (result, { width, colorSchemeDark }) => view.draw(result, width, colorSchemeDark),
  });
  return Disposable.from(view, frame);
}
