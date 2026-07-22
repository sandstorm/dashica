// The ONLY module importing dockview-core (docs/2026-07-22-dockview-rewrite.md
// §4.1/§4.2). Dockview owns GEOMETRY (pane sizes, docking, tabs, popouts); templ
// still owns MARKUP and Alpine still owns BEHAVIOR. Panels are declared in templ
// as <div data-dock-panel="name">…</div> inside an inert <template>; the `adopt`
// renderer MOVES that server-rendered element into the panel — so panel content
// stays reviewable Go, styled by the existing CSS pipeline.
import {
    createDockview,
    type DockviewApi,
    type DockviewGroupPanel,
    type IContentRenderer,
    type ITabRenderer,
    type IHeaderActionsRenderer,
    type DockviewTheme,
} from 'dockview';
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

// Once a [data-dock-panel] element is adopted it is MOVED out of the staging
// block, so it is no longer findable via querySelector. A panel that is closed
// and later re-added (the lazy debug drawer — docs §4.5) must re-adopt the SAME
// node, so keep a reference the first time we find it and reuse it thereafter.
const adoptedElements = new Map<string, Element>();

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
            if (!name) throw new Error('dock: adopt panel missing an adopt name');
            const src = adoptedElements.get(name)
                ?? document.querySelector(`[data-dock-panel="${name}"]`);
            if (!src) throw new Error(`dock: no [data-dock-panel="${name}"]`);
            adoptedElements.set(name, src); // remember for re-adoption after close
            element.appendChild(src); // move, don't clone — assembled pre-Alpine.start()
        },
    };
}

// Right-header action shown on every group with a visible header: a
// maximize/restore toggle (docs Slice D step 4). One implementation shared by
// every dock (Explore gets it for free). Header-less locked groups (the
// preview / search-bar strips) have no header, so the action never renders
// there. Double-click on the tab bar toggles the same, matching IDE ergonomics.
function maximizeAction(group: DockviewGroupPanel): IHeaderActionsRenderer {
    const element = document.createElement('div');
    element.className = 'dv-dashica-actions';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dv-dashica-action';
    element.appendChild(btn);

    let api: DockviewApi | null = null;
    const disposables: { dispose(): void }[] = [];

    const sync = () => {
        const max = group.api.isMaximized();
        btn.textContent = max ? '❏' : '⛶';
        btn.title = max ? 'Restore' : 'Maximize';
    };
    const toggle = () => {
        if (!api) return;
        if (group.api.isMaximized()) api.exitMaximizedGroup();
        else group.api.maximize();
    };

    return {
        element,
        init(params) {
            api = params.containerApi;
            btn.addEventListener('click', toggle);
            // Double-click the tab strip toggles maximize too (dockview ships no
            // default for this). The header container is our element's ancestor.
            const header = element.closest('.dv-tabs-and-actions-container');
            if (header) {
                const onDbl = () => toggle();
                header.addEventListener('dblclick', onDbl);
                disposables.push({ dispose: () => header.removeEventListener('dblclick', onDbl) });
            }
            disposables.push(api.onDidMaximizedGroupChange(sync));
            sync();
        },
        dispose() {
            disposables.forEach((d) => d.dispose());
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
        createRightHeaderActionComponent: (group) => maximizeAction(group),
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

// wireLazyDebugDrawer connects the chart wrench event (dispatched on `window` by
// chart.ts, §4.5) to a lazy debug panel added as a tab into `referenceGroup` —
// the LEFT gutter edge group (the dashboard menu / the Explore tree), so the
// drawer OVERRIDES that gutter while open instead of taking new space. A second
// wrench closes it (toggle); the gutter's other panel(s) stay. The panel is
// `closable` (its tab shows ×) and adopts [data-dock-panel="debug"]; adoption
// caches the node (adoptRenderer), so close+reopen re-adopts the same live
// element — its `debugDrawer` Alpine component (listening on `window`) keeps
// populating the query/EXPLAIN panes.
//
// The "Pop out" button inside the drawer content moves the group into a separate
// browser window (§4.5); wired via a delegated document click so it is robust to
// adoption timing and survives close+reopen. Same JS realm, so the wrench event
// still reaches the drawer; dockview mirrors its own stylesheets into the child.
export function wireLazyDebugDrawer(api: DockviewApi, referenceGroup: string) {
    window.addEventListener('dashica-debugDrawer-toggle', () => {
        const existing = api.getPanel('debug');
        if (existing) { existing.api.close(); return; } // toggle off
        api.addPanel({
            id: 'debug', component: 'adopt', title: 'Debug',
            params: { adopt: 'debug', closable: true }, renderer: 'always',
            position: { referenceGroup },
        });
    });

    document.addEventListener('click', (e) => {
        const target = e.target as HTMLElement | null;
        if (!target?.closest('[data-debug-popout]')) return;
        const panel = api.getPanel('debug');
        if (panel) api.addPopoutGroup(panel.group);
    });
}

// resetDock rebuilds the default layout. With persistence off this just reloads
// the page (the default is rebuilt on every load anyway); it also clears any
// layout blob left over from when persistence was enabled.
export function resetDock(storageKey: string) {
    localStorage.removeItem(`${storageKey}.v${STATE_VERSION}`);
    window.location.reload();
}
