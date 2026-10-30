import { html } from 'htl';
import { RefreshCw, createElement } from 'lucide';
import type { Extension } from '../../hosts/extension-host/extension-host';
import type { QueryApi } from '../../hosts/query/query';

/**
 * The time range of the page's queries, in the title bar: a preset (`Last 1h`) or a custom range from a start to an
 * end, and the refresh button (also the command `timeRange.refresh`). Picking "Custom" starts from the window of the
 * preset before and turns auto refresh off, as a fixed window does not move. A selection on a time chart shows here
 * as a custom range.
 */
export const timeRange: Extension = {
  id: 'timeRange',
  contributes: {
    commands: [{ command: 'timeRange.refresh', title: 'Refresh', category: 'Time range' }],
  },
  activate({ ui, query, commands, subscriptions }) {
    const picker = new TimeRangePicker(query);
    picker.show();
    subscriptions.push(query.time.onDidChange(() => picker.show()));
    subscriptions.push(ui.registerBarItem('title', picker.el, { alignment: 'right', priority: 30 }));
    subscriptions.push(commands.registerCommand('timeRange.refresh', () => query.refresh()));
  },
};

/** The presets, their value a Go duration as the server parses it (time.ParseDuration). */
const PRESETS = [
  { label: 'Last 5m', value: '5m', ms: 5 * 60_000 },
  { label: 'Last 15m', value: '15m', ms: 15 * 60_000 },
  { label: 'Last 1h', value: '1h', ms: 3_600_000 },
  { label: 'Last 3h', value: '3h', ms: 3 * 3_600_000 },
  { label: 'Last 6h', value: '6h', ms: 6 * 3_600_000 },
  { label: 'Last 12h', value: '12h', ms: 12 * 3_600_000 },
  { label: 'Last 24h', value: '24h', ms: 24 * 3_600_000 },
  { label: 'Last 2d', value: '48h', ms: 48 * 3_600_000 },
  { label: 'Last 7d', value: '168h', ms: 168 * 3_600_000 },
  { label: 'Last 30d', value: '720h', ms: 720 * 3_600_000 },
];

/** The select of the presets and "Custom", the start and end of a custom range, the refresh button; `show` shows `query.time`. */
class TimeRangePicker {
  readonly #select: HTMLSelectElement = html`<select class="select select-sm w-auto" aria-label="Time range"></select>`;
  readonly #from: HTMLInputElement = html`<input type="datetime-local" class="input input-sm w-auto" aria-label="From">`;
  readonly #to: HTMLInputElement = html`<input type="datetime-local" class="input input-sm w-auto" aria-label="To">`;
  readonly #custom: HTMLElement = html`<span class="flex items-center gap-1">${this.#from}<span>to</span>${this.#to}</span>`;
  readonly el: HTMLElement;

  constructor(private readonly query: QueryApi) {
    const refresh = html`<button type="button" class="btn btn-sm btn-circle btn-ghost" title="Refresh" aria-label="Refresh">${createElement(RefreshCw)}</button>`;
    refresh.addEventListener('click', () => query.refresh());
    this.#select.addEventListener('change', () => this.#pick(this.#select.value));
    this.#from.addEventListener('change', () => this.#setCustom());
    this.#to.addEventListener('change', () => this.#setCustom());
    this.el = html`<div class="flex items-center gap-2">${this.#select}${this.#custom}${refresh}</div>`;
  }

  show(): void {
    const { range, custom } = this.query.time;
    const options = PRESETS.map((preset) => ({ label: preset.label, value: preset.value }));
    // a range the page declares or the URL has (`90m`), though no preset
    if (range !== 'custom' && !PRESETS.some((preset) => preset.value === range)) options.unshift({ label: `Last ${range}`, value: range });
    this.#select.replaceChildren(
      ...options.map((option) => html`<option value=${option.value}>${option.label}</option>`),
      html`<option value="custom">Custom</option>`,
    );
    this.#select.value = range;
    this.#custom.hidden = range !== 'custom';
    // the server's format, `2026-10-29 10:00 to 2026-10-29 12:00`; the inputs' `2026-10-29T10:00`
    const [from = '', to = ''] = custom.split(' to ');
    this.#from.value = from.replace(' ', 'T');
    this.#to.value = to.replace(' ', 'T');
  }

  #pick(value: string): void {
    if (value !== 'custom') {
      this.query.time.setRange(value);
      return;
    }
    // a range without preset (`90m`) starts from the last 24h
    const before = PRESETS.find((preset) => preset.value === this.query.time.range)?.ms ?? 24 * 3_600_000;
    const now = new Date();
    this.query.time.setAutoRefresh(undefined);
    this.query.time.setCustom(new Date(now.getTime() - before), now);
  }

  #setCustom(): void {
    const from = new Date(this.#from.value);
    const to = new Date(this.#to.value);
    if (isNaN(from.getTime()) || isNaN(to.getTime()) || from >= to) return;
    this.query.time.setCustom(from, to);
  }
}
