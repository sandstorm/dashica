import * as Arrow from 'apache-arrow';
import type {QueryResult} from "../types";
import {charts} from "../components/chart";

// A widget envelope as stored in the editor state and sent to the preview API.
export interface WidgetEnvelope {
    type: string;
    props: Record<string, any>;
}

// previewRender POSTs a widget envelope to /api/preview/render and returns the
// widget's own rendered markup — the exact Chart element a compiled dashboard
// emits. The browser parses it and reads chartType + chartProps off the DOM
// node's dataset (native HTML unescaping), so there is no server-side attribute
// scraping and no parallel chartProps logic to drift.
async function previewRender(baseUrl: string, envelope: WidgetEnvelope, signal: AbortSignal): Promise<{
    chartType: string | null;
    chartProps: Record<string, any> | null;
    // The raw rendered markup, used as a static fallback for non-chart widgets.
    html: string;
}> {
    const response = await fetch(`${baseUrl}/api/preview/render`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(envelope),
        signal,
    });
    if (response.status !== 200) throw new Error(await response.text());
    const html = await response.text();

    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const chartEl = tmp.querySelector<HTMLElement>('[data-chart-props]');
    if (!chartEl) return {chartType: null, chartProps: null, html};
    return {
        chartType: chartEl.dataset.chartType ?? null,
        chartProps: JSON.parse(chartEl.dataset.chartProps ?? '{}'),
        html,
    };
}

// previewQuery POSTs a widget envelope to /api/preview/query and returns the
// decoded Arrow result — the mirror of clickhouse-new.ts query(), except the
// widget is described in the POST body. The server replays the widget's own
// query handler, so the response is byte-identical to a compiled /query.
async function previewQuery(
    baseUrl: string,
    envelope: WidgetEnvelope,
    filters: any,
    widgetParams: Record<string, string> | undefined,
    signal: AbortSignal,
): Promise<QueryResult> {
    const params = new URLSearchParams();
    if (filters) params.append("filters", JSON.stringify(filters));
    if (widgetParams && Object.keys(widgetParams).length > 0) {
        params.append("params", JSON.stringify(widgetParams));
    }

    const response = await fetch(`${baseUrl}/api/preview/query?${params.toString()}`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(envelope),
        signal,
    });
    if (response.status !== 200) throw new Error(await response.text());

    const result: QueryResult = await Arrow.tableFromIPC(response);
    result.dashicaResolvedTimeRange = JSON.parse(response.headers.get("X-Dashica-Resolved-Time-Range") || "null");
    const xBucketSize = response.headers.get("X-Dashica-Bucket-Size");
    if (xBucketSize != null) result.dashicaBucketSize = parseInt(xBucketSize);
    result.clickhouseSummary = JSON.parse(response.headers.get("X-Clickhouse-Summary") || "null");
    result.dashicaAlertIf = JSON.parse(response.headers.get("X-Dashica-Alert-If") || "null");
    return result;
}

// PreviewController owns one mounted preview: it can be re-run (render) with new
// state and torn down (destroy), aborting any in-flight fetch.
export interface PreviewController {
    render(envelope: WidgetEnvelope, filters: any, widgetParams?: Record<string, string>): void;
    destroy(): void;
}

// mountPreview renders a widget preview into `container` and returns a controller
// that re-renders on demand. Chart widgets fetch data and render through the
// same renderers as compiled dashboards; non-chart widgets fall back to their
// static server-rendered markup. Each render() aborts the previous fetch, so
// rapid edits don't stack requests.
export function mountPreview(container: HTMLElement, baseUrl: string): PreviewController {
    let abort: AbortController | null = null;
    const colorSchemeDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    function setMessage(html: string, cls = "") {
        container.innerHTML = `<div class="explore-preview-msg ${cls}">${html}</div>`;
    }

    return {
        render(envelope, filters, widgetParams) {
            if (abort) abort.abort();
            abort = new AbortController();
            const signal = abort.signal;

            previewRender(baseUrl, envelope, signal)
                .then(async ({chartType, chartProps, html}) => {
                    if (signal.aborted) return;

                    // Non-chart widget (markdown, ...): show its static markup.
                    if (!chartType || !chartProps) {
                        container.innerHTML = html;
                        return;
                    }
                    const renderer = (charts as Record<string, any>)[chartType];
                    if (!renderer) {
                        setMessage(`Live preview for <code>${chartType}</code> is not available in this build yet.`);
                        return;
                    }

                    const data = await previewQuery(baseUrl, envelope, filters, widgetParams, signal);
                    if (signal.aborted) return;
                    const el = await renderer(data, {
                        ...chartProps,
                        width: container.clientWidth || 600,
                        colorSchemeDark,
                        viewOptions: [],
                    });
                    if (signal.aborted) return;
                    container.innerHTML = '';
                    container.appendChild(el);
                })
                .catch((e) => {
                    if (signal.aborted || e.name === 'AbortError') return;
                    setMessage(`<b>ERROR:</b> ${escapeHtml(e.message)}`, "explore-preview-msg--error");
                });
        },
        destroy() {
            if (abort) abort.abort();
            container.innerHTML = '';
        },
    };
}

function escapeHtml(s: string): string {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}
