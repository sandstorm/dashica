// UNMIGRATED (workbench): bridge for the server-rendered page until step 5b renders pages on the client; then delete. See docs/2026-10-28-workbench.md §5.
import { html } from 'htl';
import { Disposable } from '../../core/disposable/disposable';
import type { Extension, ExtensionContext } from '../../hosts/extension-host/extension-host';

/**
 * Puts the parts of the server-rendered page (`[data-workbench-part]`, staged hidden by the templ layout) into the
 * workbench: the dashboards menu as the left panel "Dashboards" (a dashboard's entry has a "…" button for the menu
 * `dashboards/entry`), the search bar into the filter bar, the debug drawer as the bottom panel "Debug" (shown on a chart's
 * wrench). Runs before Alpine starts, so the parts are in place when
 * Alpine walks them.
 */
export function legacyPage(doc: Document): Extension {
  return {
    id: 'legacyPage',
    activate({ ui, commands, subscriptions }) {
      const part = (name: string) => doc.querySelector<HTMLElement>(`[data-workbench-part="${name}"]`);

      const brand = html`<a href="/" class="dashica-wb__brand">Dashica</a>`;
      subscriptions.push(ui.registerBarItem('title', brand, { alignment: 'left' }));

      const menu = part('menu');
      if (menu) {
        const panel = ui.registerSidePanel('dashboards', { label: 'Dashboards', icon: DASHBOARDS_ICON });
        panel.body.append(menu);
        panel.setDefault(true);
        subscriptions.push(panel, ...entryMenu(menu, { ui, commands }));
      }

      const searchBar = part('searchbar');
      if (searchBar && searchBar.childElementCount > 0) {
        searchBar.classList.add('dashica-wb__legacy-search-bar');
        subscriptions.push(ui.registerBarItem('filter', searchBar, { alignment: 'left' }));
      }

      const debug = part('debug');
      if (debug) {
        const panel = ui.registerBottomPanel('debug', { label: 'Debug' });
        panel.body.append(debug);
        // a chart's wrench (chart.ts) dispatches this event on the browser window, with the chart's query for the drawer
        const browserWindow = doc.defaultView!;
        const show = () => panel.show(true);
        browserWindow.addEventListener('dashica-debugDrawer-toggle', show);
        subscriptions.push(panel, new Disposable(() => browserWindow.removeEventListener('dashica-debugDrawer-toggle', show)));
      }
    },
  };
}

/** A "…" button on each dashboard's entry in `menu` for the menu `dashboards/entry`: context `{ url, title }`, argument the URL. */
function entryMenu(menu: HTMLElement, { ui, commands }: Pick<ExtensionContext, 'ui' | 'commands'>): Disposable[] {
  const browserWindow = menu.ownerDocument.defaultView!;
  const buttons = [...menu.querySelectorAll<HTMLAnchorElement>('[data-menu-entry] > a[href]')].map((link) => {
    const url = link.href;
    const title = link.textContent ?? url;
    const onclick = (event: MouseEvent) =>
      ui.showContextMenu('dashboards/entry', { anchor: event.currentTarget as HTMLElement, title, context: { url, title }, args: [url] });
    const button = html`<button type="button" class="entry-menu-btn" aria-label=${`More for ${title}`} title="More" aria-haspopup="menu" onclick=${onclick}>…</button>`;
    link.after(button);
    return button;
  });
  return [
    new Disposable(() => buttons.forEach((button) => button.remove())),
    commands.registerCommand('dashboards.openInNewTab', (url: string) => void browserWindow.open(url, '_blank', 'noopener')),
    commands.registerCommand('dashboards.copyLink', (url: string) => browserWindow.navigator.clipboard.writeText(url)),
    ui.registerMenuItem('dashboards/entry', { command: 'dashboards.openInNewTab', title: 'Open in new tab', group: 'navigation', order: 1 }),
    ui.registerMenuItem('dashboards/entry', { command: 'dashboards.copyLink', title: 'Copy link', group: 'navigation', order: 2 }),
  ];
}

/** A grid of four tiles. */
const DASHBOARDS_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>';
