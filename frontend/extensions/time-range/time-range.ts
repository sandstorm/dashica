import { html } from 'htl';
import { ChevronDown, Clock, RefreshCw, createElement } from 'lucide';
import type { Extension } from '../../hosts/extension-host/extension-host';
import type { QueryApi } from '../../hosts/query/query';
import { isRelative, parseTimeExpr } from './time-expr';

/**
 * The time range of the page's queries, in the title bar: a button showing the range ("Last 1 hour",
 * "2026-10-29 10:00 to 12:00") that opens the picker, and the refresh button (also the command `timeRange.refresh`).
 * The picker has From / To, each an absolute time or relative to now (`now-6h`, see time-expr.ts), and the quick
 * ranges (the presets), filtered by typing. A range ending at a fixed time does not move, so applying one turns auto
 * refresh off. A selection on a time chart shows here as a custom range.
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
    subscriptions.push({ dispose: () => picker.close() });
  },
};

/** The quick ranges, their value a Go duration as the server parses it (time.ParseDuration). */
const PRESETS = [
  { label: 'Last 5 minutes', value: '5m' },
  { label: 'Last 15 minutes', value: '15m' },
  { label: 'Last 1 hour', value: '1h' },
  { label: 'Last 3 hours', value: '3h' },
  { label: 'Last 6 hours', value: '6h' },
  { label: 'Last 12 hours', value: '12h' },
  { label: 'Last 24 hours', value: '24h' },
  { label: 'Last 2 days', value: '48h' },
  { label: 'Last 7 days', value: '168h' },
  { label: 'Last 30 days', value: '720h' },
];

/**
 * The range button with its panel, and the refresh button; `show` shows `query.time`. The panel closes on Escape, on a
 * click outside, and once a range is picked or applied.
 */
class TimeRangePicker {
  readonly #button: HTMLButtonElement = html`<button
    type="button"
    class="btn btn-sm btn-outline"
    aria-haspopup="dialog"
    aria-expanded="false"></button>`;
  readonly #from: HTMLInputElement = html`<input class="input input-sm w-full font-mono" aria-label="From" spellcheck="false">`;
  readonly #to: HTMLInputElement = html`<input class="input input-sm w-full font-mono" aria-label="To" spellcheck="false">`;
  readonly #error: HTMLElement = html`<div class="text-error text-xs" role="alert"></div>`;
  readonly #apply: HTMLButtonElement = html`<button type="submit" class="btn btn-sm btn-primary">Apply time range</button>`;
  readonly #search: HTMLInputElement = html`<input
    type="search"
    class="input input-sm w-full"
    placeholder="Search quick ranges"
    aria-label="Search quick ranges">`;
  readonly #quickRanges: HTMLElement = html`<ul class="menu menu-sm w-full p-0"></ul>`;
  readonly #panel: HTMLElement;
  readonly el: HTMLElement;

  constructor(private readonly query: QueryApi) {
    const form: HTMLFormElement = html`<form class="flex flex-col gap-2">
      <div class="font-semibold">Custom range</div>
      <label class="flex flex-col gap-1 text-xs">From ${this.#from}</label>
      <label class="flex flex-col gap-1 text-xs">To ${this.#to}</label>
      <div class="text-xs opacity-60">e.g. <code>2026-10-29 10:00</code> or <code>now-6h</code></div>
      ${this.#error}
      ${this.#apply}
    </form>`;
    this.#panel = html`<div
      class="absolute right-0 top-full z-50 mt-1 grid w-[34rem] max-w-[calc(100vw-1rem)] gap-4 rounded-box border border-base-300 bg-base-100 p-4 shadow-lg sm:grid-cols-2"
      role="dialog"
      aria-label="Time range">
      ${form}
      <div class="flex min-w-0 flex-col gap-2">
        ${this.#search}
        <div class="max-h-72 overflow-y-auto">${this.#quickRanges}</div>
      </div>
    </div>`;
    this.#panel.hidden = true;
    const refresh = html`<button type="button" class="btn btn-sm btn-circle btn-ghost" title="Refresh" aria-label="Refresh">${createElement(RefreshCw)}</button>`;

    this.#button.addEventListener('click', () => (this.#panel.hidden ? this.open() : this.close()));
    this.#from.addEventListener('input', () => this.#validate());
    this.#to.addEventListener('input', () => this.#validate());
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.#applyCustom();
    });
    this.#search.addEventListener('input', () => this.#showQuickRanges());
    this.#panel.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      this.close();
      this.#button.focus();
    });
    refresh.addEventListener('click', () => query.refresh());
    this.el = html`<div class="relative flex items-center gap-2">${this.#button}${this.#panel}${refresh}</div>`;
  }

  show(): void {
    this.#button.replaceChildren(createElement(Clock), this.#label(), createElement(ChevronDown));
    this.#showQuickRanges();
  }

  open(): void {
    const { range, custom } = this.query.time;
    const [from = '', to = ''] = custom.split(' to ');
    this.#from.value = range === 'custom' ? from : `now-${range}`;
    this.#to.value = range === 'custom' ? to : 'now';
    this.#search.value = '';
    this.#validate();
    this.#showQuickRanges();
    this.#panel.hidden = false;
    this.#button.setAttribute('aria-expanded', 'true');
    this.el.ownerDocument.addEventListener('pointerdown', this.#onPointerDown);
    this.#from.focus();
  }

  close(): void {
    this.#panel.hidden = true;
    this.#button.setAttribute('aria-expanded', 'false');
    this.el.ownerDocument.removeEventListener('pointerdown', this.#onPointerDown);
  }

  readonly #onPointerDown = (event: PointerEvent) => {
    if (!this.el.contains(event.target as Node)) this.close();
  };

  /** What the button says: the preset, or the custom range with its day once (`2026-10-29 10:00 to 12:00`). */
  #label(): string {
    const { range, custom } = this.query.time;
    if (range !== 'custom') return PRESETS.find((preset) => preset.value === range)?.label ?? `Last ${range}`;
    const [from = '', to = ''] = custom.split(' to ');
    const [fromDay] = from.split(' ');
    const [toDay, toTime] = to.split(' ');
    if (!isRelative(from) && !isRelative(to) && fromDay === toDay) return `${from} to ${toTime}`;
    return custom;
  }

  #showQuickRanges(): void {
    const search = this.#search.value.trim().toLowerCase();
    this.#quickRanges.replaceChildren(
      ...PRESETS.filter((preset) => preset.label.toLowerCase().includes(search)).map((preset) => {
        const item: HTMLButtonElement = html`<button type="button">${preset.label}</button>`;
        item.classList.toggle('menu-active', preset.value === this.query.time.range);
        item.addEventListener('click', () => {
          this.query.time.setRange(preset.value);
          this.close();
        });
        return html`<li>${item}</li>`;
      }),
    );
  }

  /** Marks what is wrong with From / To; `true` while both can be applied. */
  #validate(): boolean {
    const now = new Date();
    const from = parseTimeExpr(this.#from.value, now);
    const to = parseTimeExpr(this.#to.value, now);
    this.#from.classList.toggle('input-error', from === undefined);
    this.#from.setAttribute('aria-invalid', String(from === undefined));
    this.#to.classList.toggle('input-error', to === undefined);
    this.#to.setAttribute('aria-invalid', String(to === undefined));
    let error = '';
    if (from === undefined || to === undefined) error = 'A time is 2026-10-29 10:00, now, or now-6h (s m h d w).';
    else if (from >= to) error = 'From is before To.';
    this.#error.textContent = error;
    this.#apply.disabled = error !== '';
    return error === '';
  }

  #applyCustom(): void {
    if (!this.#validate()) return;
    const from = this.#from.value.trim();
    const to = this.#to.value.trim();
    if (!isRelative(to)) this.query.time.setAutoRefresh(undefined);
    this.query.time.setCustom(from, to);
    this.close();
  }
}
