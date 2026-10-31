import { html } from 'htl';
import type { MenuGroupEntry } from '../../generated/zz_generated.dashica';
import type { Extension, ExtensionContext } from '../../hosts/extension-host/extension-host';
import './dashboards.css';

/**
 * The dashboards of `workbench.json`: the left panel "Dashboards" (the viewer's favorites, then the menu groups; the
 * page shown is marked; a star makes an entry a favorite, "…" opens the menu `dashboards/entry`: context `{ url, title }`,
 * argument the URL; "Open in new tab" opens it in a tab of its own), their group in search everywhere (Cmd / Ctrl+Enter:
 * in a new tab), and "Dashica" in the title bar. Picking one opens it in the active tab.
 */
export const dashboards: Extension = {
  id: 'dashboards',
  activate(context) {
    const { ui, page, commands, subscriptions } = context;
    const brand = html`<a href="/" class="d-brand">Dashica</a>`;
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
            group.entries.map((entry) => ({
              label: entry.title,
              description: group.title,
              accept: (options?: { newTab?: boolean }) => page.navigate(entry.url, options),
            })),
          ),
      }),
    );

    subscriptions.push(commands.registerCommand('dashboards.openInNewTab', (url: string) => page.navigate(url, { newTab: true })));
    subscriptions.push(commands.registerCommand('dashboards.copyLink', (url: string) => navigator.clipboard.writeText(new URL(url, location.href).href)));
    subscriptions.push(ui.registerMenuItem('dashboards/entry', { command: 'dashboards.openInNewTab', title: 'Open in new tab', group: 'navigation', order: 1 }));
    subscriptions.push(ui.registerMenuItem('dashboards/entry', { command: 'dashboards.copyLink', title: 'Copy link', group: 'navigation', order: 2 }));
  },
};

/**
 * The list in the panel "Dashboards"; `render` draws it again (the page shown changed, a favorite was toggled). A
 * favorite names its group; a star toggled keeps its place on screen, though a favorite added or removed above moves
 * everything below it.
 */
class DashboardsMenu {
  constructor(
    private readonly el: HTMLElement,
    private readonly context: ExtensionContext,
  ) {}

  render(): void {
    const { menu } = this.context.page.workbench;
    const favorites = this.#favorites();
    const groupOf = (url: string) => menu.find((group) => group.entries.some((entry) => entry.url === url));
    const groups = menu.map((group) => this.#group(group.title, group.entries.map((entry) => this.#entry(group.title, entry, favorites))));
    const favoriteGroup =
      favorites.length === 0
        ? ''
        : this.#group(
            'Favorites',
            favorites.map((favorite) => this.#entry('Favorites', favorite, favorites, groupOf(favorite.url)?.title)),
          );
    this.el.replaceChildren(html`<ul class="d-dashboards-menu">${favoriteGroup}${groups}</ul>`);
  }

  #group(title: string, entries: readonly HTMLElement[]): HTMLElement {
    return html`<li class="d-dashboards-menu__group">
      <h2 class="d-list__heading d-dashboards-menu__heading">${title}</h2>
      <ul class="d-list d-dashboards-menu__entries">${entries}</ul>
    </li>`;
  }

  /** An entry of the list `section` (a group's title, "Favorites"); `group` is a favorite's group, shown after its title. */
  #entry(section: string, entry: MenuGroupEntry, favorites: readonly MenuGroupEntry[], group?: string): HTMLElement {
    const isFavorite = favorites.some((favorite) => favorite.url === entry.url);
    const showMenu = (event: MouseEvent) =>
      this.context.ui.showContextMenu('dashboards/entry', {
        anchor: event.currentTarget as HTMLElement,
        title: entry.title,
        context: { url: entry.url, title: entry.title },
        args: [entry.url],
      });
    return html`<li class="d-dashboards-menu__entry">
      ${this.#link(entry, group)}
      <button type="button" class="d-dashboards-menu__more" aria-label=${`More for ${entry.title}`} title="More" aria-haspopup="menu" onclick=${showMenu}>…</button>
      <button
        type="button"
        class=${isFavorite ? 'd-dashboards-menu__star d-dashboards-menu__star--active' : 'd-dashboards-menu__star'}
        data-key=${`${section} ${entry.url}`}
        aria-label=${isFavorite ? `Remove ${entry.title} from the favorites` : `Add ${entry.title} to the favorites`}
        onclick=${(event: MouseEvent) => this.#toggleFavorite(entry, event.currentTarget as HTMLElement)}>${isFavorite ? '★' : '☆'}</button>
    </li>`;
  }

  #link(entry: MenuGroupEntry, group?: string): HTMLElement {
    const shown = entry.url === new URL(this.context.page.activeTab.url, location.origin).pathname;
    return html`<a href=${entry.url} class=${shown ? 'd-list__item d-list__item--active' : 'd-list__item'} title=${group ? `${entry.title} (${group})` : entry.title}
      >${entry.title}${group ? html`<span class="d-dashboards-menu__group-name">${group}</span>` : ''}</a
    >`;
  }

  /** The viewer's favorites, in the order they were added. */
  #favorites(): MenuGroupEntry[] {
    const stored = this.context.globalState.get<unknown>('favorites', []);
    if (!Array.isArray(stored)) return [];
    return stored.filter((f): f is MenuGroupEntry => typeof f?.url === 'string' && typeof f?.title === 'string');
  }

  /** Toggles `entry` with its `star`, which then stays where it was on screen and keeps the focus. */
  #toggleFavorite(entry: MenuGroupEntry, star: HTMLElement): void {
    const favorites = this.#favorites();
    const kept = favorites.filter((favorite) => favorite.url !== entry.url);
    void this.context.globalState.update('favorites', kept.length < favorites.length ? kept : [...favorites, { url: entry.url, title: entry.title }]);
    const top = star.getBoundingClientRect().top;
    const hadFocus = document.activeElement === star;
    this.render();
    const again = [...this.el.querySelectorAll<HTMLElement>('.d-dashboards-menu__star')].find((el) => el.dataset.key === star.dataset.key);
    if (!again) return;
    this.el.scrollTop += again.getBoundingClientRect().top - top;
    if (hadFocus) again.focus();
  }
}

/** A grid of four tiles. */
const DASHBOARDS_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>';
