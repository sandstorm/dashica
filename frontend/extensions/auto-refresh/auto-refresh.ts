import { html } from 'htl';
import type { Extension } from '../../hosts/extension-host/extension-host';

/**
 * Auto refresh in the title bar: a toggle that queries the page again every 30 seconds (`?refresh=30`), with a
 * spinner while it is on.
 */
export const autoRefresh: Extension = {
  id: 'autoRefresh',
  activate({ ui, query, subscriptions }) {
    const toggle: HTMLInputElement = html`<input type="checkbox" class="toggle toggle-primary toggle-sm">`;
    const spinner: HTMLElement = html`<span class="loading loading-spinner loading-xs text-primary"></span>`;
    toggle.addEventListener('change', () => query.time.setAutoRefresh(toggle.checked ? INTERVAL_SECONDS : undefined));
    const show = () => {
      toggle.checked = query.time.autoRefresh !== undefined;
      spinner.hidden = !toggle.checked;
    };
    show();
    subscriptions.push(query.time.onDidChange(show));
    const item = html`<label class="label cursor-pointer gap-2">
      <span class="label-text font-medium">Auto-refresh</span>
      ${toggle}
      ${spinner}
    </label>`;
    subscriptions.push(ui.registerBarItem('title', item, { alignment: 'right', priority: 20 }));
  },
};

const INTERVAL_SECONDS = 30;
