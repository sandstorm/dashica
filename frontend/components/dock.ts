// The ONLY module importing dockview-core (docs/2026-07-22-dockview-rewrite.md
// §4.1/§4.2). Dockview owns GEOMETRY (pane sizes, docking, tabs, popouts); templ
// still owns MARKUP and Alpine still owns BEHAVIOR. Panels are declared in templ
// as <div data-dock-panel="name">…</div> inside an inert <template>; the `adopt`
// renderer MOVES that server-rendered element into the panel — so panel content
// stays reviewable Go, styled by the existing CSS pipeline.
import { createDockview, type DockviewApi, type IContentRenderer, type ITabRenderer, type DockviewTheme } from 'dockview';
import 'dockview/dist/styles/dockview.css';

// A theme is just a className carrying the --dv-* variables (mapped onto daisyUI
// tokens in the per-view CSS) plus the light/dark hint dockview uses internally.
const dashicaTheme: DockviewTheme = {
    name: 'dashica',
    className: 'dockview-theme-dashica',
    colorScheme:
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light',
};

// The single panel renderer: adopt a server-rendered element by name. Uses
// renderer:'always' at the call site so the moved DOM (and its live Alpine
// components) stays mounted even while the panel is hidden — an inactive tab
// must not tear down its adopted content.
function adoptRenderer(): IContentRenderer {
    const element = document.createElement('div');
    element.className = 'dock-adopt';
    return {
        element,
        init(params) {
            const name = (params.params as { adopt?: string } | undefined)?.adopt;
            const src = name ? document.querySelector(`[data-dock-panel="${name}"]`) : null;
            if (!src) throw new Error(`dock: no [data-dock-panel="${name}"]`);
            element.appendChild(src); // move, don't clone — assembled pre-Alpine.start()
        },
    };
}

// Tab renderer that shows the close (×) action ONLY for panels whose params mark
// them `closable`. The default dockview tab always shows close; we want most
// panes non-removable but a few (e.g. the Explore tree sidebar) removable. Reads
// the same panel params as the content renderer. Structural classes match
// dockview's default tab so the shipped CSS styles it.
function dashicaTab(): ITabRenderer {
    const element = document.createElement('div');
    element.className = 'dv-default-tab';
    const content = document.createElement('span');
    content.className = 'dv-default-tab-content';
    const action = document.createElement('span');
    action.className = 'dv-default-tab-action';
    action.textContent = '✕';
    element.append(content, action);
    return {
        element,
        init(params) {
            content.textContent = params.title ?? '';
            const closable = !!(params.params as { closable?: boolean } | undefined)?.closable;
            action.style.display = closable ? '' : 'none';
            action.addEventListener('pointerdown', (e) => e.preventDefault());
            action.addEventListener('click', (e) => { e.preventDefault(); params.api.close(); });
            params.api.onDidTitleChange((e) => { content.textContent = e.title ?? ''; });
        },
    };
}

// Bump to invalidate saved layouts when the panel set / default arrangement
// changes shape (a stale saved layout would otherwise mask the new default).
export const STATE_VERSION = 4;

// initDock creates a dockview in `container` and builds the default layout.
//
// Layout persistence is DISABLED for now (per request): no localStorage read or
// autosave — every load starts from `buildDefaultLayout`. The `storageKey` param
// is kept so re-enabling persistence later is a localized change (restore the
// fromJSON restore + debounced toJSON autosave here, behind `STATE_VERSION`).
export function initDock(
    container: HTMLElement,
    storageKey: string,
    buildDefaultLayout: (api: DockviewApi) => void,
): DockviewApi {
    void storageKey; // persistence intentionally off for now
    const api = createDockview(container, {
        theme: dashicaTheme,
        defaultTabComponent: 'dashica-tab',
        createTabComponent: (options) =>
            options.name === 'dashica-tab' ? dashicaTab() : undefined,
        createComponent: (options) => {
            switch (options.name) {
                case 'adopt':
                    return adoptRenderer();
                default:
                    throw new Error(`dock: unknown component "${options.name}"`);
            }
        },
    });

    buildDefaultLayout(api);
    return api;
}

// resetDock rebuilds the default layout. With persistence off this just reloads
// the page (the default is rebuilt on every load anyway); it also clears any
// layout blob left over from when persistence was enabled.
export function resetDock(storageKey: string) {
    localStorage.removeItem(`${storageKey}.v${STATE_VERSION}`);
    window.location.reload();
}
