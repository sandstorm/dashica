// UNMIGRATED (workbench): bridge for the server-rendered page until step 5b renders pages on the client; then delete. See docs/2026-10-28-workbench.md §5.
import { Disposable } from '../../core/disposable/disposable';
import type { Extension } from '../../hosts/extension-host/extension-host';

/**
 * Puts the parts of the server-rendered page (`[data-workbench-part]`, staged hidden by the templ layout) into the
 * workbench: the dashboards menu as the left panel "Dashboards", the search bar into the filter bar, the debug drawer as
 * the bottom panel "Debug" (shown on a chart's wrench). Runs before Alpine starts, so the parts are in place when
 * Alpine walks them.
 */
export function legacyPage(doc: Document): Extension {
  return {
    id: 'legacyPage',
    activate({ window, subscriptions }) {
      const part = (name: string) => doc.querySelector<HTMLElement>(`[data-workbench-part="${name}"]`);

      const brand = doc.createElement('a');
      brand.href = '/';
      brand.className = 'dashica-wb__brand';
      brand.textContent = 'Dashica';
      subscriptions.push(window.registerBarItem('title', brand, { alignment: 'left' }));

      const menu = part('menu');
      if (menu) {
        const panel = window.registerSidePanel('dashboards', { label: 'Dashboards', icon: DASHBOARDS_ICON });
        panel.body.append(menu);
        panel.setDefault(true);
        subscriptions.push(panel);
      }

      const searchBar = part('searchbar');
      if (searchBar && searchBar.childElementCount > 0) {
        searchBar.classList.add('dashica-wb__legacy-search-bar');
        subscriptions.push(window.registerBarItem('filter', searchBar, { alignment: 'left' }));
      }

      const debug = part('debug');
      if (debug) {
        const panel = window.registerBottomPanel('debug', { label: 'Debug' });
        panel.body.append(debug);
        const show = () => panel.show(true);
        globalThis.addEventListener('dashica-debugDrawer-toggle', show);
        subscriptions.push(panel, new Disposable(() => globalThis.removeEventListener('dashica-debugDrawer-toggle', show)));
      }
    },
  };
}

/** A grid of four tiles. */
const DASHBOARDS_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>';
