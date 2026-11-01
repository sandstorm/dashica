import { html } from 'htl';
import { instance as viz } from '@viz-js/viz';
import { Bug, SquareArrowOutUpRight, createElement } from 'lucide';
import { Disposable } from '../../core/disposable/disposable';
import type { Extension, Memento } from '../../hosts/extension-host/extension-host';
import type { QueryResult, RenderedWidget, WidgetDecoration } from '../../hosts/widgets/widgets';
import { createView, type MenuAnchor } from '../../hosts/ui/ui';
import { drawTable, type ShowTableMenu } from '../chart-library/table';
import { widgetTitle } from '../widget-library/widget-title';
import './debug.css';

/**
 * The left side panel "Debug" and the status bar's item, both about the active widget (`widgets.active`). The panel
 * shows, as views, what the widget queried: the SQL as sent, its decorations with their source (whatever they mean),
 * its stats, ClickHouse's EXPLAIN (plan, pipeline as a graph and as steps, syntax), from its `<dataUrl>/debug` with its
 * tab's query state, and the result it drew last as a table. It follows the active widget's status
 * (`onDidChangeStatus`) and decorations (`onDidChangeDecorations`), and asks `/debug` only while it is shown: on
 * showing, on another active widget, and when that widget's query answered or failed. Which widget it is tells its
 * outline, not the panel. "Pop out" (the panel's menu `panel/debug`, its command enabled while a widget is active)
 * shows the same for the active widget
 * in a tab of its own, which keeps following that widget's status, not the active widget. The status bar
 * says the widget's rows, query time and its decorations' badges, or its error ("No active chart" on the start page); a
 * click on it opens the panel, as the chart menu's "Debug" (`widget/context`) does.
 */
export const debug: Extension = {
  id: 'debug',
  activate({ ui, widgets, page, commands, globalState, subscriptions }) {
    const panel = ui.registerSidePanel('debug', { label: 'Debug', icon: createElement(Bug).outerHTML, order: 10 });
    subscriptions.push(panel);
    // its result table's menus (`table/cell`, `table/header`)
    const showMenu = (menuId: string, anchor: MenuAnchor, context: object) => ui.showContextMenu(menuId, { anchor, title: 'Debug', context, args: [context] });
    const statusElement: HTMLButtonElement = html`<button type="button" class="d-debug-status" data-testid="debug-status" onclick=${() => panel.show()}></button>`;
    subscriptions.push(ui.registerBarItem('status', statusElement, { alignment: 'left' }));

    /** What the panel shows while visible: the active widget's debug info, followed. */
    let showing: Disposable | undefined;
    const showPanel = () => {
      showing?.dispose();
      showing = undefined;
      if (!panel.visible) return;
      const active = widgets.active;
      if (active) showing = followDebug(panel.bodyContainer, active, showMenu, globalState);
      else panel.bodyContainer.replaceChildren(html`<div class="d-debug__hint">Click a chart to see what it queried.</div>`);
    };
    /** The active widget's status and decorations, listened to for the status bar. */
    let following: Disposable | undefined;
    const follow = () => {
      following?.dispose();
      const active = widgets.active;
      const redraw = () => drawStatus(statusElement, active);
      following = active && Disposable.from(active.onDidChangeStatus(redraw), active.onDidChangeDecorations(redraw));
      drawStatus(statusElement, widgets.active);
      showPanel();
    };
    follow();
    subscriptions.push(widgets.onDidChangeActive(follow), panel.onDidChangeVisibility(showPanel));
    subscriptions.push({ dispose: () => (showing?.dispose(), following?.dispose()) });
    // a press on the chart's menu button made it active already
    subscriptions.push(commands.registerCommand('debug.showWidget', () => panel.show()));
    subscriptions.push(ui.registerMenuItem('widget/context', { command: 'debug.showWidget', title: 'Debug', group: 'debug' }));
    subscriptions.push(
      commands.registerCommand(
        'debug.popOut',
        () => {
          const active = widgets.active;
          if (!active) return;
          return page.popOut({
            title: `Debug: ${widgetTitle(active.widget)}`,
            render: (viewContainer) => {
              const tabElement: HTMLElement = viewContainer.appendChild(html`<div class="d-debug-tab"></div>`);
              return followDebug(tabElement, active, showMenu, globalState);
            },
          });
        },
        { enablement: () => widgets.active !== undefined, disabledReason: 'No active chart' },
      ),
      ui.registerMenuItem('panel/debug', { command: 'debug.popOut', title: 'Pop out', icon: createElement(SquareArrowOutUpRight).outerHTML }),
    );
  },
};

/**
 * Shows in `debugContainer` what `widget` queried (`showDebug`), and asks again when its query answered or failed.
 * While its query runs, `debugContainer` keeps what it shows; an aborted query putting back the status asked for asks
 * nothing. Its decorations are drawn anew on each change.
 */
export function followDebug(debugContainer: HTMLElement, widget: RenderedWidget, showMenu: ShowTableMenu, state: Memento): Disposable {
  let loading = new AbortController();
  let asked = widget.status;
  const decorationsContainer: HTMLElement = html`<div class="d-debug__decorations"></div>`;
  const drawDecorations = () => decorationsContainer.replaceChildren(decorationList(widget.decorations));
  drawDecorations();
  void showDebug(debugContainer, widget, decorationsContainer, showMenu, state, loading.signal);
  const listening = widget.onDidChangeStatus(() => {
    if (widget.status.kind === 'loading' || widget.status === asked) return;
    loading.abort();
    loading = new AbortController();
    asked = widget.status;
    void showDebug(debugContainer, widget, decorationsContainer, showMenu, state, loading.signal);
  });
  const decorating = widget.onDidChangeDecorations(drawDecorations);
  return new Disposable(() => {
    loading.abort();
    listening.dispose();
    decorating.dispose();
  });
}

/** `decorations` as a table, each its source, badge, tooltip and whether it mutes; "None." without one. */
export function decorationList(decorations: readonly WidgetDecoration[]): HTMLElement {
  if (decorations.length === 0) return html`<p class="d-debug__none">None.</p>`;
  return html`<table class="d-debug__decoration-table">
    <thead><tr><th>Source</th><th>Badge</th><th>Tooltip</th><th>Muted</th></tr></thead>
    <tbody>${decorations.map(({ source, badge, tooltip, muted }) => html`<tr><td>${source}</td><td>${badge}</td><td>${tooltip ?? ''}</td><td>${muted ? 'yes' : 'no'}</td></tr>`)}</tbody>
  </table>`;
}

/** What `<dataUrl>/debug` answers (httpserver.DebugInfo). */
interface DebugInfo {
  query: string;
  explainPlan: string;
  /** A DOT graph (`digraph { … }`), else text. */
  explainPipeline: string;
  explainPipelineText: string;
  explainSyntax: string;
  stats: unknown;
}

/**
 * Fills `debugContainer` with what `active` queried, as views (their state in `state`), `decorationsContainer` (its
 * decorations, drawn by the caller) among them; a failed request shows its error there.
 */
async function showDebug(debugContainer: HTMLElement, active: RenderedWidget, decorationsContainer: HTMLElement, showMenu: ShowTableMenu, state: Memento, signal: AbortSignal): Promise<void> {
  debugContainer.replaceChildren(html`<div class="d-debug"><span class="d-spinner"></span></div>`);
  let info: DebugInfo;
  try {
    const response = await fetch(active.url('/debug'), { signal });
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
    info = await response.json();
  } catch (error) {
    if (signal.aborted) return;
    debugContainer.replaceChildren(html`<div class="d-debug"><div class="d-notice d-notice--error">${error instanceof Error ? error.message : String(error)}</div></div>`);
    return;
  }
  if (signal.aborted) return;

  const pipelineContainer: HTMLElement = html`<div class="d-debug__block"></div>`;
  const resultContainer: HTMLElement = html`<div class="d-debug__result"></div>`;
  const view = (id: string, name: string, bodyElement: Node, collapsed = false) => createView({ id, title: name, collapsed, state, body: html`<div class="d-debug__content">${bodyElement}</div>` });
  debugContainer.replaceChildren(html`<div class="d-debug">
    ${view('query', 'Query', pre(info.query))}
    ${view('decorations', 'Decorations', decorationsContainer)}
    ${view(
      'stats',
      'Stats',
      html`<div class="d-debug__parts">
        ${pre(JSON.stringify(info.stats, null, 2))}
        <h3 class="d-debug__heading">ClickHouse summary of the chart's answer</h3>
        ${pre(JSON.stringify(active.lastResult ? clickhouseSummaryOf(active.lastResult) : null, null, 2))}
      </div>`,
      true,
    )}
    ${view('plan', 'EXPLAIN plan', pre(info.explainPlan))}
    ${view(
      'pipeline',
      'Pipeline',
      html`<div class="d-debug__parts">
        ${pipelineContainer}
        <h3 class="d-debug__heading">Steps</h3>
        ${pre(info.explainPipelineText)}
      </div>`,
      true,
    )}
    ${view('syntax', 'Syntax', pre(info.explainSyntax), true)}
    ${view('result', 'Result', resultContainer)}
  </div>`);

  if (active.lastResult) resultContainer.append(drawTable(active.lastResult, { height: 400 }, { showMenu }));
  else resultContainer.textContent = 'The chart has not queried yet.';
  await showPipeline(pipelineContainer, info.explainPipeline);
}

/** Fills the status bar's item with how `active`'s last query went; a hint without one. */
function drawStatus(statusElement: HTMLElement, active: RenderedWidget | undefined): void {
  const parts = statusParts(active);
  statusElement.replaceChildren(...parts.map(({ text, tone }) => html`<span class=${`d-debug-status__part d-debug-status__part--${tone}`}>${text}</span>`));
  statusElement.title = active ? `${active.status.kind === 'error' ? `${active.status.message}\n` : ''}Show Debug` : 'Show Debug';
}

/** One piece of the status bar's item: its text and how it reads (`error` red, `muted`). */
export interface StatusPart {
  readonly text: string;
  readonly tone: 'plain' | 'muted' | 'error';
}

/** What the status bar says about `active`: rows and time with its decorations' badges, or its error (its first line). */
export function statusParts(active: RenderedWidget | undefined): readonly StatusPart[] {
  if (!active) return [{ text: 'No active chart', tone: 'muted' }];
  const { status } = active;
  switch (status.kind) {
    case 'idle':
      return [{ text: 'not queried yet', tone: 'muted' }];
    case 'loading':
      return [{ text: 'querying…', tone: 'muted' }];
    case 'error':
      return [{ text: shorten(status.message), tone: 'error' }, { text: `${status.ms} ms`, tone: 'muted' }];
    case 'done':
      return [
        { text: `${status.rows.toLocaleString('en')} ${status.rows === 1 ? 'row' : 'rows'}`, tone: 'plain' },
        { text: `${status.ms} ms`, tone: 'plain' },
        ...active.decorations.map(({ badge }): StatusPart => ({ text: badge, tone: 'muted' })),
      ];
  }
}

/** ClickHouse's summary of the query that answered `result` (X-Clickhouse-Summary: rows and bytes read, elapsed time); `null` without. */
export function clickhouseSummaryOf({ headers }: Pick<QueryResult, 'headers'>): unknown {
  return JSON.parse(headers.get('X-Clickhouse-Summary') || 'null');
}

/** The first line of `message`, at most 80 characters. */
function shorten(message: string): string {
  const line = message.trim().split('\n')[0];
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

function pre(text: string): HTMLElement {
  return html`<pre class="d-debug__block">${text}</pre>`;
}

/** The pipeline as a graph when ClickHouse gave a DOT graph, else as text; also as text when the graph cannot be drawn. */
async function showPipeline(pipelineContainer: HTMLElement, pipeline: string): Promise<void> {
  if (!pipeline.trim().startsWith('digraph')) {
    pipelineContainer.replaceChildren(pre(pipeline));
    return;
  }
  try {
    const svgElement = (await viz()).renderSVGElement(pipeline);
    svgElement.setAttribute('width', '100%');
    svgElement.setAttribute('height', 'auto');
    svgElement.style.maxWidth = '100%';
    pipelineContainer.replaceChildren(svgElement);
  } catch (error) {
    console.error('Failed to render DOT graph:', error);
    pipelineContainer.replaceChildren(pre(pipeline));
  }
}
