import { html } from 'htl';
import { instance as viz } from '@viz-js/viz';
import { Bug, SquareArrowOutUpRight, createElement } from 'lucide';
import { Disposable } from '../../core/disposable/disposable';
import type { Extension, Memento } from '../../hosts/extension-host/extension-host';
import type { RenderedWidget } from '../../hosts/widgets/widgets';
import { createView, type MenuAnchor } from '../../hosts/ui/ui';
import { drawTable, type ShowTableMenu } from '../chart-library/table';
import { widgetTitle } from '../widget-library/widget-title';
import './debug.css';

/**
 * The left side panel "Debug" and the status bar's item, both about the active widget (`widgets.active`). The panel
 * shows, as views, what the widget queried: the SQL as sent, its stats, ClickHouse's EXPLAIN (plan, pipeline as a
 * graph and as steps, syntax), from its `<dataUrl>/debug` with its tab's query state, and the result it drew last as
 * a table. It follows the active widget's status (`onDidChangeStatus`) and asks `/debug` only while it is shown: on
 * showing, on another active widget, and when that widget's query answered or failed. Which widget it is tells its
 * outline, not the panel. "Pop out" (the panel's menu `panel/debug`) shows the same for the active widget
 * in a tab of its own, which keeps following that widget's status, not the active widget. The status bar
 * says the widget's rows, query time, its error or the filters it ignores ("No active chart" on the start page); a
 * click on it opens the panel, as the chart menu's "Debug" (`widget/context`) does.
 */
export const debug: Extension = {
  id: 'debug',
  activate({ ui, widgets, page, commands, globalState, subscriptions }) {
    const panel = ui.registerSidePanel('debug', { label: 'Debug', icon: createElement(Bug).outerHTML, order: 10 });
    subscriptions.push(panel);
    // its result table's menus (`table/cell`, `table/header`)
    const showMenu = (menuId: string, anchor: MenuAnchor, context: object) => ui.showContextMenu(menuId, { anchor, title: 'Debug', context, args: [context] });
    const status: HTMLButtonElement = html`<button type="button" class="d-debug-status" data-testid="debug-status" onclick=${() => panel.show()}></button>`;
    subscriptions.push(ui.registerBarItem('status', status, { alignment: 'left' }));

    /** What the panel shows while visible: the active widget's debug info, followed. */
    let showing: Disposable | undefined;
    const showPanel = () => {
      showing?.dispose();
      showing = undefined;
      if (!panel.visible) return;
      const active = widgets.active;
      if (active) showing = followDebug(panel.body, active, showMenu, globalState);
      else panel.body.replaceChildren(html`<div class="d-debug__hint">Click a chart to see what it queried.</div>`);
    };
    /** The active widget's status, listened to for the status bar. */
    let following: Disposable | undefined;
    const follow = () => {
      following?.dispose();
      following = widgets.active?.onDidChangeStatus(() => drawStatus(status, widgets.active));
      drawStatus(status, widgets.active);
      showPanel();
    };
    follow();
    subscriptions.push(widgets.onDidChangeActive(follow), panel.onDidChangeVisibility(showPanel));
    subscriptions.push({ dispose: () => (showing?.dispose(), following?.dispose()) });
    // a press on the chart's menu button made it active already
    subscriptions.push(commands.registerCommand('debug.showWidget', () => panel.show()));
    subscriptions.push(ui.registerMenuItem('widget/context', { command: 'debug.showWidget', title: 'Debug', group: 'debug' }));
    subscriptions.push(
      commands.registerCommand('debug.popOut', () => {
        const active = widgets.active;
        if (!active) return;
        return page.popOut({
          title: `Debug: ${widgetTitle(active.widget)}`,
          render: (el) => {
            const tab: HTMLElement = el.appendChild(html`<div class="d-debug-tab"></div>`);
            return followDebug(tab, active, showMenu, globalState);
          },
        });
      }),
      ui.registerMenuItem('panel/debug', {
        command: 'debug.popOut',
        title: 'Pop out',
        icon: createElement(SquareArrowOutUpRight).outerHTML,
        enabled: () => widgets.active !== undefined,
        tooltip: 'The active chart’s debug info in a tab of its own',
      }),
    );
  },
};

/**
 * Shows in `el` what `widget` queried (`showDebug`), and asks again when its query answered or failed. While its query
 * runs, `el` keeps what it shows; an aborted query putting back the status asked for asks nothing.
 */
export function followDebug(el: HTMLElement, widget: RenderedWidget, showMenu: ShowTableMenu, state: Memento): Disposable {
  let loading = new AbortController();
  let asked = widget.status;
  void showDebug(el, widget, showMenu, state, loading.signal);
  const listening = widget.onDidChangeStatus(() => {
    if (widget.status.kind === 'loading' || widget.status === asked) return;
    loading.abort();
    loading = new AbortController();
    asked = widget.status;
    void showDebug(el, widget, showMenu, state, loading.signal);
  });
  return new Disposable(() => {
    loading.abort();
    listening.dispose();
  });
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

/** Fills `el` with what `active` queried, as views (their state in `state`); a failed request shows its error there. */
async function showDebug(el: HTMLElement, active: RenderedWidget, showMenu: ShowTableMenu, state: Memento, signal: AbortSignal): Promise<void> {
  el.replaceChildren(html`<div class="d-debug"><span class="d-spinner"></span></div>`);
  let info: DebugInfo;
  try {
    const response = await fetch(active.url('/debug'), { signal });
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
    info = await response.json();
  } catch (error) {
    if (signal.aborted) return;
    el.replaceChildren(html`<div class="d-debug"><div class="d-notice d-notice--error">${error instanceof Error ? error.message : String(error)}</div></div>`);
    return;
  }
  if (signal.aborted) return;

  const pipeline: HTMLElement = html`<div class="d-debug__block"></div>`;
  const result: HTMLElement = html`<div class="d-debug__result"></div>`;
  const view = (id: string, name: string, body: Node, collapsed = false) => createView({ id, title: name, collapsed, state, body: html`<div class="d-debug__content">${body}</div>` });
  el.replaceChildren(html`<div class="d-debug">
    ${view('query', 'Query', pre(info.query))}
    ${view(
      'stats',
      'Stats',
      html`<div class="d-debug__parts">
        ${pre(JSON.stringify(info.stats, null, 2))}
        <h3 class="d-debug__heading">ClickHouse summary of the chart's answer</h3>
        ${pre(JSON.stringify(active.lastResult?.clickhouseSummary ?? null, null, 2))}
      </div>`,
      true,
    )}
    ${view('plan', 'EXPLAIN plan', pre(info.explainPlan))}
    ${view(
      'pipeline',
      'Pipeline',
      html`<div class="d-debug__parts">
        ${pipeline}
        <h3 class="d-debug__heading">Steps</h3>
        ${pre(info.explainPipelineText)}
      </div>`,
      true,
    )}
    ${view('syntax', 'Syntax', pre(info.explainSyntax), true)}
    ${view('result', 'Result', result)}
  </div>`);

  if (active.lastResult) result.append(drawTable(active.lastResult, { height: 400 }, { showMenu }));
  else result.textContent = 'The chart has not queried yet.';
  await showPipeline(pipeline, info.explainPipeline);
}

/** Fills the status bar's item with how `active`'s last query went; a hint without one. */
function drawStatus(el: HTMLElement, active: RenderedWidget | undefined): void {
  const parts = statusParts(active);
  el.replaceChildren(...parts.map(({ text, tone }) => html`<span class=${`d-debug-status__part d-debug-status__part--${tone}`}>${text}</span>`));
  el.title = active ? `${active.status.kind === 'error' ? `${active.status.message}\n` : ''}Show Debug` : 'Show Debug';
}

/** One piece of the status bar's item: its text and how it reads (`error` red, `muted`). */
export interface StatusPart {
  readonly text: string;
  readonly tone: 'plain' | 'muted' | 'error';
}

/** What the status bar says about `active`: rows and time, its error (its first line), or the filters it ignores. */
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
    case 'done': {
      const { ignored = [], skipped } = status.diagnostics;
      if (skipped) return [{ text: `skipped: ${skipped}`, tone: 'muted' }];
      const parts: StatusPart[] = [{ text: `${status.rows.toLocaleString('en')} ${status.rows === 1 ? 'row' : 'rows'}`, tone: 'plain' }, { text: `${status.ms} ms`, tone: 'plain' }];
      if (ignored.length > 0) parts.push({ text: `ignores ${ignored.join(', ')}`, tone: 'muted' });
      return parts;
    }
  }
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
async function showPipeline(el: HTMLElement, pipeline: string): Promise<void> {
  if (!pipeline.trim().startsWith('digraph')) {
    el.replaceChildren(pre(pipeline));
    return;
  }
  try {
    const svg = (await viz()).renderSVGElement(pipeline);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', 'auto');
    svg.style.maxWidth = '100%';
    el.replaceChildren(svg);
  } catch (error) {
    console.error('Failed to render DOT graph:', error);
    el.replaceChildren(pre(pipeline));
  }
}
