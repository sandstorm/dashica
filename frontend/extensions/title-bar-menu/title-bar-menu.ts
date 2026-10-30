import { html } from 'htl';
import { EllipsisVertical, createElement } from 'lucide';
import type { Extension } from '../../hosts/extension-host/extension-host';

/**
 * "⋮" at the right end of the title bar: opens the menu `titleBar/more`, where extensions put what is set for the
 * whole page and needs no place of its own (log scale). Hidden while the menu is empty.
 */
export const titleBarMenu: Extension = {
  id: 'titleBarMenu',
  activate({ ui, subscriptions }) {
    const button: HTMLButtonElement = html`<button
      type="button"
      class="btn btn-sm btn-circle btn-ghost"
      title="More"
      aria-label="More"
      aria-haspopup="menu">${createElement(EllipsisVertical)}</button>`;
    button.addEventListener('click', () => ui.showContextMenu('titleBar/more', { anchor: button, title: 'More' }));
    const show = () => (button.hidden = ui.getMenuItems('titleBar/more').length === 0);
    show();
    subscriptions.push(ui.onDidChangeMenu((menuId) => menuId === 'titleBar/more' && show()));
    subscriptions.push(ui.registerBarItem('title', button, { alignment: 'right', priority: -100 }));
  },
};
