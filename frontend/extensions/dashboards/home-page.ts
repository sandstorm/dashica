import { html } from 'htl';
import type { MenuGroup, MenuGroupEntry } from '../../generated/zz_generated.dashica';
import './home-page.css';

/**
 * See `dashboards` in dashboards.ts. The start page "/" (page kind `home`): the viewer's `favorites` as tiles, each its
 * title and its group, in the viewer's order (with none, a hint to star one); then every group of `menu` with its
 * dashboards.
 */
export function homePage(menu: readonly MenuGroup[], favorites: readonly MenuGroupEntry[]): HTMLElement {
  const groupOf = (url: string) => menu.find((group) => group.entries.some((entry) => entry.url === url))?.title;
  const tiles =
    favorites.length === 0
      ? html`<p class="d-home-page__hint">No favorites yet: star a dashboard (☆) in the Dashboards panel to find it here.</p>`
      : html`<ul class="d-home-page__tiles">
          ${favorites.map(
            (favorite) =>
              html`<li>
                <a class="d-home-page__tile" href=${favorite.url}
                  ><span class="d-home-page__tile-title">${favorite.title}</span><span class="d-home-page__tile-group">${groupOf(favorite.url) ?? ''}</span></a
                >
              </li>`,
          )}
        </ul>`;
  return html`<div class="d-home-page">
    <section>
      <h2 class="d-home-page__heading">Favorites</h2>
      ${tiles}
    </section>
    ${menu.map(
      (group) =>
        html`<section>
          <h2 class="d-home-page__heading">${group.title}</h2>
          <ul class="d-home-page__dashboards">
            ${group.entries.map((entry) => html`<li><a class="d-home-page__dashboard" href=${entry.url}>${entry.title}</a></li>`)}
          </ul>
        </section>`,
    )}
  </div>`;
}
