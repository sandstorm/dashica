import { html } from 'htl';
import { RefreshCw, createElement } from 'lucide';
import { Disposable } from '../../core/disposable/disposable';
import type { Extension } from '../../hosts/extension-host/extension-host';
import type { PageApi } from '../../hosts/page/page';
import type { QueryApi } from '../../hosts/query/query';
import { REFRESH, type AutoRefresh } from '../time-library/refresh-state';

/**
 * Refresh in the top bar, as one split button: ⟳ queries the page again now (also the command `refresh.now`), the
 * interval beside it queries again every so often (the query key `REFRESH`, declared here, `?refresh=30`; "Off" by
 * default). On every page, the start page too. Auto refresh pauses while its tab is in the background or the browser
 * tab is hidden (`autoRefresh`).
 */
export const refresh: Extension = {
  id: 'refresh',
  contributes: {
    commands: [{ command: 'refresh.now', title: 'Refresh', category: 'Page' }],
  },
  activate({ ui, query, page, commands, subscriptions }) {
    subscriptions.push(query.declare(REFRESH));
    const buttonElement: HTMLButtonElement = html`<button
      type="button"
      class="d-button d-button--icon d-segmented__item"
      title="Refresh"
      aria-label="Refresh">${createElement(RefreshCw, { width: 16, height: 16 })}</button>`;
    const intervalElement: HTMLSelectElement = html`<select
      class="d-field d-segmented__item"
      aria-label="Auto refresh"></select>`;
    buttonElement.addEventListener('click', () => query.refresh());
    const timer = autoRefresh(query, page, buttonElement.ownerDocument);
    intervalElement.addEventListener('change', () => timer.set(intervalElement.value === '' ? undefined : Number(intervalElement.value)));
    const draw = () => {
      const shown = query.get(REFRESH);
      const options = INTERVALS.map((option) => ({ label: option.label, value: String(option.seconds ?? '') }));
      // an interval the URL has (`?refresh=45`), though none offered
      if (shown !== undefined && !INTERVALS.some((option) => option.seconds === shown)) options.push({ label: `${shown}s`, value: String(shown) });
      intervalElement.replaceChildren(...options.map((option) => html`<option value=${option.value}>${option.label}</option>`));
      intervalElement.value = String(shown ?? '');
    };
    draw();
    subscriptions.push(timer, query.onDidChange(REFRESH, draw));
    subscriptions.push(commands.registerCommand('refresh.now', () => query.refresh()));
    const itemElement = html`<div class="d-segmented">${buttonElement}${intervalElement}</div>`;
    subscriptions.push(ui.registerBarItem('top', itemElement, { alignment: 'right', priority: 20 }));
  },
};

/**
 * Refreshes the active tab, and only it, every `seconds`, one interval after its last refresh (of any cause), paused
 * while the browser tab is hidden. A tab shown again, or the browser tab, refreshes at once when its interval passed
 * meanwhile, else when it passes. `set` takes a new interval for the active tab, its next refresh a whole interval
 * later.
 */
function autoRefresh(
  query: QueryApi,
  page: Pick<PageApi, 'tabs' | 'activeTab' | 'onDidChangeTabs'>,
  doc: Document,
): Disposable & { set(seconds: AutoRefresh): void } {
  /** When each tab was refreshed last, by its id, in ms. */
  const last = new Map<string, number>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    const interval = query.get(REFRESH);
    if (!interval || doc.hidden) return;
    const { id } = page.activeTab;
    if (!last.has(id)) last.set(id, Date.now());
    const wait = last.get(id)! + interval * 1000 - Date.now();
    if (wait <= 0) query.refresh();
    else timer = setTimeout(() => query.refresh(), wait);
  };
  const refreshed = () => {
    last.set(page.activeTab.id, Date.now());
    schedule();
  };
  const tabsChanged = () => {
    for (const id of last.keys()) if (!page.tabs.some((tab) => tab.id === id)) last.delete(id);
    schedule();
  };
  const listening = Disposable.from(
    query.onDidRequestRefresh(refreshed),
    query.onDidChange(REFRESH, schedule),
    page.onDidChangeTabs(tabsChanged),
  );
  doc.addEventListener('visibilitychange', schedule);
  schedule();
  return Object.assign(
    new Disposable(() => {
      clearTimeout(timer);
      listening.dispose();
      doc.removeEventListener('visibilitychange', schedule);
    }),
    {
      set(interval: AutoRefresh) {
        last.set(page.activeTab.id, Date.now());
        query.set(REFRESH, interval);
      },
    },
  );
}

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
