import { html } from 'htl';
import type { Extension } from '../../hosts/extension-host/extension-host';

/** The log scale in the title bar: a toggle for `query.viewOptions.logScale` (`?log=1`), which every chart reads. */
export const logScale: Extension = {
  id: 'logScale',
  activate({ ui, query, subscriptions }) {
    const toggle: HTMLInputElement = html`<input type="checkbox" class="toggle toggle-sm">`;
    toggle.addEventListener('change', () => query.viewOptions.setLogScale(toggle.checked));
    const show = () => (toggle.checked = query.viewOptions.logScale);
    show();
    subscriptions.push(query.viewOptions.onDidChange(show));
    const item = html`<label class="label cursor-pointer gap-2">
      <span class="label-text font-medium">Log scale</span>
      ${toggle}
    </label>`;
    subscriptions.push(ui.registerBarItem('title', item, { alignment: 'right', priority: 10 }));
  },
};
