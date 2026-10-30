import { html } from 'htl';
import { RefreshCw, createElement } from 'lucide';
import type { Extension } from '../../hosts/extension-host/extension-host';

/**
 * Refresh in the title bar, as one split button: ⟳ queries the page again now (also the command `refresh.now`), the
 * interval beside it queries again every so often (`?refresh=30`; "Off" by default).
 */
export const refresh: Extension = {
  id: 'refresh',
  contributes: {
    commands: [{ command: 'refresh.now', title: 'Refresh', category: 'Page' }],
  },
  activate({ ui, query, commands, subscriptions }) {
    const button: HTMLButtonElement = html`<button
      type="button"
      class="d-button d-button--icon d-segmented__item"
      title="Refresh"
      aria-label="Refresh">${createElement(RefreshCw, { width: 16, height: 16 })}</button>`;
    const interval: HTMLSelectElement = html`<select
      class="d-field d-segmented__item"
      aria-label="Auto refresh"></select>`;
    button.addEventListener('click', () => query.refresh());
    interval.addEventListener('change', () => query.time.setAutoRefresh(interval.value === '' ? undefined : Number(interval.value)));
    const show = () => {
      const seconds = query.time.autoRefresh;
      const options = INTERVALS.map((option) => ({ label: option.label, value: String(option.seconds ?? '') }));
      // an interval the URL has (`?refresh=45`), though none offered
      if (seconds !== undefined && !INTERVALS.some((option) => option.seconds === seconds)) options.push({ label: `${seconds}s`, value: String(seconds) });
      interval.replaceChildren(...options.map((option) => html`<option value=${option.value}>${option.label}</option>`));
      interval.value = String(seconds ?? '');
    };
    show();
    subscriptions.push(query.time.onDidChange(show));
    subscriptions.push(commands.registerCommand('refresh.now', () => query.refresh()));
    subscriptions.push(ui.registerBarItem('title', html`<div class="d-segmented">${button}${interval}</div>`, { alignment: 'right', priority: 20 }));
  },
};

/** The auto refresh intervals offered; `undefined`: off. */
const INTERVALS = [
  { label: 'Off', seconds: undefined },
  { label: '10s', seconds: 10 },
  { label: '30s', seconds: 30 },
  { label: '1m', seconds: 60 },
  { label: '5m', seconds: 300 },
  { label: '15m', seconds: 900 },
  { label: '1h', seconds: 3600 },
];
