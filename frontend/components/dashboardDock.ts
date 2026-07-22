// dashboardDock.ts — the dockview shell for compiled dashboards (defaultPage),
// docs/2026-07-22-dockview-rewrite.md Slice D. Mirrors the Explore editor's
// edge-group shape (frontend/explore/editor.ts):
//
//   • LEFT edge group  — the sidebar menu (collapsible, resizable, structural).
//   • CENTRE main grid — the dashboard content as a TAB GROUP from day one
//     (visible header, unlocked) so Slice E can open further dashboards as tabs
//     with no layout change. A locked, header-less search-bar strip sits above
//     it (same pattern as Explore's preview-controls).
//   • Debug drawer     — added LAZILY below the content on the first wrench
//     click (§4.5), never occupying space until used; a "Pop out" button moves
//     its group to a separate browser window. Row details (Slice F) will join
//     it in a bottom edge group later; this slice keeps the drawer as a plain
//     below-group, which dockview auto-removes when closed.
//
// Dockview owns GEOMETRY only. Every panel is an `adopt` of a server-rendered
// [data-dock-panel] element (dock.ts) — templ still owns MARKUP, Alpine still
// owns BEHAVIOR. Assembly runs BEFORE Alpine.start() (initDashboardDock, called
// from the page's inline script) so panes are in their final position when
// Alpine walks the tree.
import { initDock, wireLazyDebugDrawer, type DockviewApi } from './dock';

// localStorage key for the dashboard dock layout. Persistence is disabled for
// now (dock.ts), but the key is threaded through so re-enabling it later is a
// one-line change there.
const DASHBOARD_DOCK_KEY = 'dashica.dashboard.dock';

// `renderer: 'always'` keeps adopted DOM (and its live Alpine components)
// mounted while a panel is hidden — an inactive tab must not tear down its
// content (matters once Slice E stacks dashboard tabs).
const R = { renderer: 'always' as const };
const adopt = (id: string, closable = false) =>
    ({ id, component: 'adopt' as const, params: { adopt: id, closable }, ...R });

// hasStagedPanel reports whether the templ staging block rendered a given panel
// with real content — the search bar is optional (searchBar.IsVisible), so its
// staging element may be empty and must then be skipped rather than reserving an
// empty strip.
function hasStagedPanel(name: string): boolean {
    const el = document.querySelector(`[data-dock-panel="${name}"]`);
    return !!el && el.childElementCount > 0;
}

function dashboardLayout(api: DockviewApi) {
    const hasSearchbar = hasStagedPanel('searchbar');

    // TOP edge group: the global search bar / SQL-filter strip — a full-width
    // top dock above everything (menu included), because time range + SQL filter
    // are global controls (Slice A: one page scope drives every panel). Locked +
    // header-less: it is state, not a user-draggable pane. Skipped when the page
    // renders no search bar.
    if (hasSearchbar) {
        api.addEdgeGroup('top', { id: 'searchbar-edge', initialSize: 160, minimumSize: 80 });
    }
    // LEFT edge group: the sidebar menu — collapsible/resizable structural slot.
    api.addEdgeGroup('left', { id: 'menu-edge', initialSize: 460, minimumSize: 300 });

    // Centre main grid: the dashboard content as a tab group (unlocked, visible
    // header — Slice E adds further tabs), titled by the document.
    api.addPanel({ ...adopt('content'), title: document.title || 'Dashboard' });

    // Search bar into its top edge group, locked + header-less.
    if (hasSearchbar) {
        api.addPanel({ ...adopt('searchbar'), position: { referenceGroup: 'searchbar-edge' } });
        const sb = api.getPanel('searchbar');
        if (sb) {
            sb.group.locked = 'no-drop-target';
            sb.group.header.hidden = true;
        }
    }

    // Menu into its edge group.
    api.addPanel({ ...adopt('menu'), title: 'Menu', position: { referenceGroup: 'menu-edge' } });

    // Debug drawer starts absent — added lazily on the first wrench click as a
    // big, maximizable split BELOW the centre content panel (full-width, so the
    // query/EXPLAIN are readable).
    wireLazyDebugDrawer(api, 'content');
}

// The assembled dashboard dock, built by initDashboardDock() BEFORE
// Alpine.start() (§4.2 rule 2).
let dashboardDockApi: DockviewApi | null = null;

// initDashboardDock assembles the dock and adopts the staged panes into it.
// Called from defaultPage's inline script before window.Alpine.start(). No-op on
// pages without a #dashboard-dock container (docs pages stay pure SSR).
export function initDashboardDock() {
    const container = document.getElementById('dashboard-dock');
    if (!container) return;
    dashboardDockApi = initDock(container, DASHBOARD_DOCK_KEY, dashboardLayout);
}
