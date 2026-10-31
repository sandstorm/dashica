import { html } from 'htl';
import { GripVertical, createElement } from 'lucide';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import type { MenuGroupEntry } from '../../generated/zz_generated.dashica';
import type { Extension, ExtensionContext, Memento } from '../../hosts/extension-host/extension-host';
import { createView } from '../../hosts/ui/ui';
import './dashboards.css';
import { homePage } from './home-page';

/**
 * The dashboards of `workbench.json`: the left panel "Dashboards" (the viewer's favorites, in the viewer's order, then
 * the menu groups, each a view the viewer closes and opens; the page shown is marked; a star makes an entry a favorite, "…" opens the menu `dashboards/entry`: context `{ url, title }`,
 * argument the URL; "Open in new tab" opens it in a tab of its own), their group in search everywhere (Cmd / Ctrl+Enter:
 * in a new tab), the start page "/" (page kind `home`: the favorites as tiles, then the groups), and "Dashica" in the
 * title bar, a link to it. Picking one opens it in the active tab.
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
    const favoritesChanged = new EventEmitter<void>();
    subscriptions.push(favoritesChanged);
    const menu = new DashboardsMenu(panel.body, context, () => favoritesChanged.fire());
    menu.render();
    subscriptions.push(
      page.registerPageRenderer('home', (el) => {
        const draw = () => el.replaceChildren(homePage(page.workbench.menu, favoritesOf(context.globalState)));
        draw();
        return favoritesChanged.event(draw);
      }),
    );
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
 * The list in the panel "Dashboards": a view per menu group, after the favorites' view; `render` draws it again (the
 * page shown changed, a favorite was toggled or moved). A favorite names its group and moves by its grip (dragged) or
 * with Alt+ArrowUp / Alt+ArrowDown; a star toggled keeps its place on screen, though a favorite added or removed above
 * moves everything below it.
 */
class DashboardsMenu {
  constructor(
    private readonly el: HTMLElement,
    private readonly context: ExtensionContext,
    /** Called when the viewer changed the favorites (toggled or moved one). */
    private readonly onDidChangeFavorites: () => void,
  ) {}

  render(): void {
    const { menu } = this.context.page.workbench;
    const favorites = this.#favorites();
    const groupOf = (url: string) => menu.find((group) => group.entries.some((entry) => entry.url === url));
    const groups = menu.map((group) =>
      this.#view(`group.${group.title}`, group.title, group.entries.map((entry) => this.#entry(group.title, entry, favorites))),
    );
    const favoriteView =
      favorites.length === 0
        ? ''
        : this.#view(
            'favorites',
            'Favorites',
            favorites.map((favorite) => this.#favorite(favorite, favorites, groupOf(favorite.url)?.title)),
          );
    this.el.replaceChildren(html`<div class="d-dashboards-menu">${favoriteView}${groups}</div>`);
  }

  #view(id: string, title: string, entries: readonly HTMLElement[]): HTMLElement {
    return createView({
      id,
      title,
      description: String(entries.length),
      state: this.context.globalState,
      body: html`<ul class="d-list d-dashboards-menu__entries">${entries}</ul>`,
    });
  }

  /** An entry of the view `section` (a group's title, "Favorites"); `group` is a favorite's group, shown after its title. */
  #entry(section: string, entry: MenuGroupEntry, favorites: readonly MenuGroupEntry[], group?: string): HTMLElement {
    const isFavorite = favorites.some((favorite) => favorite.url === entry.url);
    const showMenu = (event: MouseEvent) =>
      this.context.ui.showContextMenu('dashboards/entry', {
        anchor: event.currentTarget as HTMLElement,
        title: entry.title,
        context: { url: entry.url, title: entry.title },
        args: [entry.url],
      });
    return html`<li class="d-dashboards-menu__entry" data-url=${entry.url}>
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

  /** An entry of "Favorites": its grip in front, Alt+ArrowUp / Alt+ArrowDown on any of its parts move it. */
  #favorite(entry: MenuGroupEntry, favorites: readonly MenuGroupEntry[], group?: string): HTMLElement {
    const row = this.#entry('Favorites', entry, favorites, group);
    const grip = html`<span class="d-dashboards-menu__grip" aria-hidden="true" title="Drag to move (or Alt+↑ / Alt+↓)"
      onpointerdown=${(event: PointerEvent) => this.#drag(event, row)}>${createElement(GripVertical, { width: 14, height: 14 })}</span>`;
    row.prepend(grip);
    row.querySelector('a')!.setAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown');
    row.addEventListener('keydown', (event) => {
      const step = ({ ArrowUp: -1, ArrowDown: 1 } as Record<string, number>)[event.key];
      if (step === undefined || !event.altKey) return;
      event.preventDefault();
      this.#moveFromKeyboard(entry.url, step, event.target as HTMLElement);
    });
    return row;
  }

  #link(entry: MenuGroupEntry, group?: string): HTMLElement {
    const shown = entry.url === new URL(this.context.page.activeTab.url, location.origin).pathname;
    return html`<a href=${entry.url} class=${shown ? 'd-list__item d-list__item--active' : 'd-list__item'} title=${group ? `${entry.title} (${group})` : entry.title}
      >${entry.title}${group ? html`<span class="d-dashboards-menu__group-name">${group}</span>` : ''}</a
    >`;
  }

  #favorites(): MenuGroupEntry[] {
    return favoritesOf(this.context.globalState);
  }

  #store(favorites: readonly Pick<MenuGroupEntry, 'url' | 'title'>[]): void {
    void this.context.globalState.update('favorites', favorites.map(({ url, title }) => ({ url, title })));
    this.onDidChangeFavorites();
  }

  /** Stores the favorites in the order of `urls`. */
  #order(urls: readonly string[]): void {
    const favorites = this.#favorites();
    const ordered = urls.flatMap((url) => favorites.filter((favorite) => favorite.url === url));
    this.#store(ordered);
  }

  /** Toggles `entry` with its `star`, which then stays where it was on screen and keeps the focus. */
  #toggleFavorite(entry: MenuGroupEntry, star: HTMLElement): void {
    const favorites = this.#favorites();
    const kept = favorites.filter((favorite) => favorite.url !== entry.url);
    this.#store(kept.length < favorites.length ? kept : [...favorites, entry]);
    const top = star.getBoundingClientRect().top;
    const hadFocus = document.activeElement === star;
    this.render();
    const again = [...this.el.querySelectorAll<HTMLElement>('.d-dashboards-menu__star')].find((el) => el.dataset.key === star.dataset.key);
    if (!again) return;
    this.el.scrollTop += again.getBoundingClientRect().top - top;
    if (hadFocus) again.focus();
  }

  /** Moves the favorite `url` by `step` places; the part of it that had the focus (`focused`) keeps it. */
  #moveFromKeyboard(url: string, step: number, focused: HTMLElement): void {
    const urls = this.#favorites().map((favorite) => favorite.url);
    const from = urls.indexOf(url);
    const to = Math.min(urls.length - 1, Math.max(0, from + step));
    if (from === to) return;
    const part = [...(focused.closest('li')?.children ?? [])].indexOf(focused);
    this.#order(moved(urls, from, to));
    this.render();
    const row = [...this.el.querySelectorAll<HTMLElement>('.d-dashboards-menu__grip')].map((grip) => grip.parentElement!).find((li) => li.dataset.url === url);
    (row?.children[part] as HTMLElement | undefined)?.focus();
  }

  /**
   * Drags the favorite `row` from its grip (`event`, the main button): it moves in the list as the pointer passes the middle of another
   * favorite; releasing stores the order, Escape or a cancelled pointer puts it back.
   */
  #drag(event: PointerEvent, row: HTMLElement): void {
    if (event.button !== 0) return;
    event.preventDefault();
    const list = row.parentElement!;
    const doc = row.ownerDocument;
    const move = (e: PointerEvent) => {
      const others = [...list.children].filter((other) => other !== row);
      const next = others.find((other) => {
        const box = other.getBoundingClientRect();
        return e.clientY < box.top + box.height / 2;
      });
      if (row.nextElementSibling !== (next ?? null)) list.insertBefore(row, next ?? null);
    };
    const stop = () => {
      doc.removeEventListener('pointermove', move);
      doc.removeEventListener('pointerup', drop);
      doc.removeEventListener('pointercancel', cancel);
      doc.removeEventListener('keydown', onkeydown, true);
      row.classList.remove('d-dashboards-menu__entry--dragged');
    };
    const drop = () => {
      stop();
      this.#order([...list.children].map((li) => (li as HTMLElement).dataset.url!));
      this.render();
    };
    const cancel = () => {
      stop();
      this.render();
    };
    const onkeydown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      cancel();
    };
    row.classList.add('d-dashboards-menu__entry--dragged');
    doc.addEventListener('pointermove', move);
    doc.addEventListener('pointerup', drop);
    doc.addEventListener('pointercancel', cancel);
    doc.addEventListener('keydown', onkeydown, true);
  }
}

/** The viewer's favorites in `globalState`, in the viewer's order (a new one last). */
function favoritesOf(globalState: Memento): MenuGroupEntry[] {
  const stored = globalState.get<unknown>('favorites', []);
  if (!Array.isArray(stored)) return [];
  return stored.filter((f): f is MenuGroupEntry => typeof f?.url === 'string' && typeof f?.title === 'string');
}

/** `list` with its item at `from` moved to `to`. */
function moved<T>(list: readonly T[], from: number, to: number): T[] {
  const rest = list.filter((_, i) => i !== from);
  return [...rest.slice(0, to), list[from], ...rest.slice(to)];
}

/** A grid of four tiles. */
const DASHBOARDS_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>';
