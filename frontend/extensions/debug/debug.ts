import { html } from 'htl';
import { instance as viz } from '@viz-js/viz';
import type { Extension } from '../../hosts/extension-host/extension-host';
import type { WidgetMenuContext } from '../../hosts/widgets/widgets';
import { drawTable } from '../chart-library/table';
import './debug.css';

/**
 * The bottom panel "Debug": what a chart queried, from its menu's "Debug" (`widget/context`). The SQL query as sent,
 * ClickHouse's EXPLAIN (plan, pipeline as a graph and as steps, syntax) and stats, all from the chart's
 * `<dataUrl>/debug` with the page's query state, and the result the chart drew last as a table.
 */
export const debug: Extension = {
  id: 'debug',
  activate({ ui, commands, subscriptions }) {
    const panel = ui.registerBottomPanel('debug', { label: 'Debug' });
    subscriptions.push(panel);
    let loading: AbortController | undefined;
    subscriptions.push(
      commands.registerCommand('debug.showWidget', async (widget: WidgetMenuContext) => {
        loading?.abort();
        loading = new AbortController();
        panel.show(true);
        await showDebug(panel.body, widget, loading.signal);
      }),
    );
    subscriptions.push({ dispose: () => loading?.abort() });
    subscriptions.push(ui.registerMenuItem('widget/context', { command: 'debug.showWidget', title: 'Debug', group: 'debug' }));
  },
};

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

/** Fills `el` with what `widget` queried; a failed request shows its error there. */
async function showDebug(el: HTMLElement, widget: WidgetMenuContext, signal: AbortSignal): Promise<void> {
  el.replaceChildren(html`<div class="d-debug"><span class="d-spinner"></span></div>`);
  let info: DebugInfo;
  try {
    const response = await fetch(widget.url('/debug'), { signal });
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
    info = await response.json();
  } catch (error) {
    if (signal.aborted) return;
    el.replaceChildren(html`<div class="d-notice d-notice--error">${error instanceof Error ? error.message : String(error)}</div>`);
    return;
  }
  if (signal.aborted) return;

  const pipeline: HTMLElement = html`<div class="d-debug__block"></div>`;
  const results: HTMLElement = html`<div></div>`;
  el.replaceChildren(html`<div class="d-debug">
    ${section('SQL Query', true, pre(info.query))}
    ${section('EXPLAIN PLAN (with indexes & actions)', true, pre(info.explainPlan))}
    ${section(
      'EXPLAIN PIPELINE (execution pipeline)',
      false,
      html`<div class="d-debug__parts">
        <div>
          <h3 class="d-debug__heading">Visual Graph:</h3>
          ${pipeline}
        </div>
        <div>
          <h3 class="d-debug__heading">Detailed Steps:</h3>
          ${pre(info.explainPipelineText)}
        </div>
      </div>`,
    )}
    ${section('EXPLAIN SYNTAX (optimized query)', false, pre(info.explainSyntax))}
    ${section('Query Stats', false, pre(JSON.stringify(info.stats, null, 2)))}
    ${section('Query Results', true, results)}
    ${section('Clickhouse Summary (Legacy)', false, pre(JSON.stringify(widget.lastResult?.clickhouseSummary ?? null, null, 4)))}
  </div>`);

  if (widget.lastResult) results.append(drawTable(widget.lastResult, { height: 400 }));
  else results.textContent = 'The chart has not queried yet.';
  await showPipeline(pipeline, info.explainPipeline);
}

/** A section the viewer opens and closes, open at first when `open`. */
function section(title: string, open: boolean, content: HTMLElement): HTMLElement {
  const shown: HTMLDetailsElement = html`<details class="d-debug__section">
    <summary class="d-debug__summary">${title}</summary>
    <div class="d-debug__content">${content}</div>
  </details>`;
  shown.open = open;
  return shown;
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
