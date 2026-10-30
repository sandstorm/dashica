import { html } from 'htl';
import type { MenuGroupEntry } from '../../generated/zz_generated.dashica';
import type { Extension, ExtensionContext } from '../../hosts/extension-host/extension-host';
import './dashboards.css';

/**
 * The dashboards of `workbench.json`: the left panel "Dashboards" (the viewer's favorites, then the menu groups; the
 * page shown is marked; a star makes an entry a favorite, "…" opens the menu `dashboards/entry`: context `{ url, title }`,
 * argument the URL), their group in search everywhere, and "Dashica" in the title bar. Picking one opens it in the
 * content area.
 */
export const dashboards: Extension = {
  id: 'dashboards',
  activate(context) {
    const { ui, page, commands, subscriptions } = context;
    const brand = html`<a href="/" class="dashica-wb__brand">Dashica</a>`;
    subscriptions.push(ui.registerBarItem('title', brand, { alignment: 'left' }));

    const panel = ui.registerSidePanel('dashboards', { label: 'Dashboards', icon: DASHBOARDS_ICON });
    panel.setDefault(true);
    subscriptions.push(panel);
    const menu = new DashboardsMenu(panel.body, context);
    menu.render();
    subscriptions.push(page.onDidChangePage(() => menu.render()));
    // on a narrow workbench, the panel lies over the dashboard just picked
    subscriptions.push(page.onDidChangePage(() => panel.dismiss()));

    subscriptions.push(
      ui.registerSearchProvider({
        id: 'dashboards.dashboards',
        label: 'Dashboards',
        order: 10,
        provideItems: () =>
          page.workbench.menu.flatMap((group) =>
            group.entries.map((entry) => ({ label: entry.title, description: group.title, accept: () => page.navigate(entry.url) })),
          ),
      }),
    );

    subscriptions.push(commands.registerCommand('dashboards.openInNewTab', (url: string) => void window.open(url, '_blank', 'noopener')));
    subscriptions.push(commands.registerCommand('dashboards.copyLink', (url: string) => navigator.clipboard.writeText(new URL(url, location.href).href)));
    subscriptions.push(ui.registerMenuItem('dashboards/entry', { command: 'dashboards.openInNewTab', title: 'Open in new tab', group: 'navigation', order: 1 }));
    subscriptions.push(ui.registerMenuItem('dashboards/entry', { command: 'dashboards.copyLink', title: 'Copy link', group: 'navigation', order: 2 }));
  },
};

/** The list in the panel "Dashboards"; `render` draws it again (the page shown changed, a favorite was toggled). */
class DashboardsMenu {
  constructor(
    private readonly el: HTMLElement,
    private readonly context: ExtensionContext,
  ) {}

  render(): void {
    const favorites = this.#favorites();
    const groups = this.context.page.workbench.menu.map((group) => html`<li>
      <h2 class="menu-title">${group.title}</h2>
      <ul>${group.entries.map((entry) => this.#entry(entry, favorites))}</ul>
    </li>`);
    const favoriteGroup = favorites.length === 0 ? '' : html`<li>
      <h2 class="menu-title">Favorites</h2>
      <ul>${favorites.map((favorite) => html`<li>${this.#link(favorite)}</li>`)}</ul>
    </li>`;
    this.el.replaceChildren(html`<ul class="menu dashboards-menu">${favoriteGroup}${groups}</ul>`);
  }

  #entry(entry: MenuGroupEntry, favorites: readonly MenuGroupEntry[]): HTMLElement {
    const isFavorite = favorites.some((favorite) => favorite.url === entry.url);
    const showMenu = (event: MouseEvent) =>
      this.context.ui.showContextMenu('dashboards/entry', {
        anchor: event.currentTarget as HTMLElement,
        title: entry.title,
        context: { url: entry.url, title: entry.title },
        args: [entry.url],
      });
    return html`<li>
      ${this.#link(entry)}
      <button type="button" class="dashboards-menu__more" aria-label=${`More for ${entry.title}`} title="More" aria-haspopup="menu" onclick=${showMenu}>…</button>
      <button
        type="button"
        class=${isFavorite ? 'dashboards-menu__star dashboards-menu__star--active' : 'dashboards-menu__star'}
        aria-label=${isFavorite ? `Remove ${entry.title} from the favorites` : `Add ${entry.title} to the favorites`}
        onclick=${() => this.#toggleFavorite(entry)}>${isFavorite ? '★' : '☆'}</button>
    </li>`;
  }

  #link(entry: MenuGroupEntry): HTMLElement {
    const shown = entry.url === location.pathname;
    return html`<a href=${entry.url} class=${shown ? 'menu-active' : ''}>${entry.title}</a>`;
  }

  /** The viewer's favorites, in the order they were added. */
  #favorites(): MenuGroupEntry[] {
    const stored = this.context.globalState.get<unknown>('favorites', []);
    if (!Array.isArray(stored)) return [];
    return stored.filter((f): f is MenuGroupEntry => typeof f?.url === 'string' && typeof f?.title === 'string');
  }

  #toggleFavorite(entry: MenuGroupEntry): void {
    const favorites = this.#favorites();
    const kept = favorites.filter((favorite) => favorite.url !== entry.url);
    void this.context.globalState.update('favorites', kept.length < favorites.length ? kept : [...favorites, { url: entry.url, title: entry.title }]);
    this.render();
  }
}

/** A grid of four tiles. */
const DASHBOARDS_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>';
