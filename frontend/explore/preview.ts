import Alpine from '@alpinejs/csp';

// A widget envelope as stored in the editor state and sent to the preview API.
export interface WidgetEnvelope {
    type: string;
    props: Record<string, any>;
}

// PreviewController owns one mounted preview; render() (re)mounts it, destroy()
// tears it down.
export interface PreviewController {
    render(envelope: WidgetEnvelope): void;
    // Show a plain text message in place of a chart (readiness/validation hints)
    // — aborts any in-flight render so a stale query can't overwrite it.
    message(text: string, cls?: string): void;
    destroy(): void;
}

function destroyTree(el: HTMLElement) {
    const d = (Alpine as any).destroyTree;
    if (typeof d === 'function') d(el);
}

// mountPreview renders a widget preview into `container`. It asks the server to
// render the widget's OWN component (POST /api/preview/render) and injects that
// markup verbatim — the exact Chart element a compiled dashboard emits, except
// each chart element is stamped server-side with data-preview-base /
// data-preview-body (its own widget envelope). The real `chart` Alpine component
// then takes over: it reads its own data-chart-props, fetches data by POSTing
// that envelope to preview/query, reacts to the time range, and drives the debug
// drawer — all reused, nothing parsed. Because the stamping is per-element, a
// container's nested charts each fetch their own data (not just the first).
// Non-chart widgets (markdown, …) render as their static server markup.
export function mountPreview(container: HTMLElement, baseUrl: string): PreviewController {
    let abort: AbortController | null = null;

    function setMessage(text: string, cls = "") {
        destroyTree(container);
        container.textContent = '';
        const d = document.createElement('div');
        d.className = `explore-preview-msg ${cls}`;
        d.textContent = text; // textContent, never innerHTML — no injection from state
        container.appendChild(d);
    }

    return {
        render(envelope) {
            if (abort) abort.abort();
            abort = new AbortController();
            const signal = abort.signal;

            fetch(`${baseUrl}/api/preview/render`, {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify(envelope),
                signal,
            })
                .then((r) => r.ok ? r.text() : r.text().then((t) => { throw new Error(t); }))
                .then((html) => {
                    if (signal.aborted) return;
                    // Tear down the previous render's Alpine components first.
                    destroyTree(container);
                    // Server-rendered widget markup (templ-escaped), not free text.
                    // Every chart element (including those nested in a container)
                    // already carries its own data-preview-base / data-preview-body,
                    // stamped by preview/render — so no client retrofit is needed.
                    container.innerHTML = html;
                    // Activate the injected component(s) — the chart (or any
                    // static widget's Alpine bits).
                    Alpine.initTree(container);
                })
                .catch((e) => {
                    if (signal.aborted || e.name === 'AbortError') return;
                    setMessage(`ERROR: ${e.message}`, "explore-preview-msg--error");
                });
        },
        message(text, cls = "explore-preview-msg--hint") {
            if (abort) abort.abort();
            abort = null;
            setMessage(text, cls);
        },
        destroy() {
            if (abort) abort.abort();
            destroyTree(container);
            container.innerHTML = '';
        },
    };
}
