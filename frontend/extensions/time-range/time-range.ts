import { html } from 'htl';
import { ChevronDown, ChevronLeft, ChevronRight, Clock, ZoomOut, createElement } from 'lucide';
import type { Extension, Memento } from '../../hosts/extension-host/extension-host';
import type { QueryApi } from '../../hosts/query/query';
import { formatTime } from '../time-library/format-time';
import { REFRESH } from '../time-library/refresh-state';
import { TIME, customRange, presetRange } from '../time-library/time-state';
import './time-range.css';

/**
 * The time range of the page's queries (the query key `TIME`, declared here: `?time=1h`, `?time=custom&range=…`), in
 * the top bar: a button showing the range ("Last 1 hour", "2026-10-29 10:00 to 12:00") that opens the picker, ‹ ›
 * shifting the window by its length, ⊖ zooming out to twice the window. On every page, the start page too. The picker
 * has From / To, each an absolute time or relative to now (`now-6h`), and the quick ranges (the presets), filtered by
 * typing, and the last three custom ranges applied (per viewer). Only the server reads the times: Apply asks it
 * (`/time-range`) and shows its reason when it cannot. A range ending at a fixed time stays fixed, so applying one
 * turns auto refresh off (the query key `REFRESH`). A selection on a time chart shows here as a custom range.
 */
export const timeRange: Extension = {
  id: 'timeRange',
  activate({ ui, query, globalState, subscriptions }) {
    subscriptions.push(query.declare(TIME));
    const picker = new TimeRangePicker(query, globalState);
    picker.show();
    subscriptions.push(query.onDidChange(TIME, () => picker.show()));
    subscriptions.push(ui.registerBarItem('top', picker.pickerContainer, { alignment: 'right', priority: 30 }));
    subscriptions.push({ dispose: () => picker.close() });
  },
};

/**
 * The range button with its panel, shift and zoom out; `show` shows `time`. The panel closes on Escape, on a
 * click outside, and once a range is picked or applied.
 */
class TimeRangePicker {
  readonly #buttonElement: HTMLButtonElement = html`<button
    type="button"
    class="d-button d-segmented__item"
    aria-haspopup="dialog"
    aria-expanded="false"></button>`;
  readonly #fromElement: HTMLInputElement = html`<input class="d-field d-field--full d-field--mono" aria-label="From" spellcheck="false">`;
  readonly #toElement: HTMLInputElement = html`<input class="d-field d-field--full d-field--mono" aria-label="To" spellcheck="false">`;
  readonly #errorElement: HTMLElement = html`<div class="d-time-picker__error" role="alert"></div>`;
  readonly #applyButtonElement: HTMLButtonElement = html`<button type="submit" class="d-button d-button--primary">Apply time range</button>`;
  readonly #searchElement: HTMLInputElement = html`<input
    type="search"
    class="d-field d-field--full"
    placeholder="Search quick ranges"
    aria-label="Search quick ranges">`;
  readonly #quickRangesContainer: HTMLElement = html`<ul class="d-list"></ul>`;
  readonly #recentContainer: HTMLElement = html`<ul class="d-list"></ul>`;
  readonly #recentSectionContainer: HTMLElement = html`<div class="d-time-picker__section">
    <div class="d-time-picker__heading">Recently used</div>
    ${this.#recentContainer}
  </div>`;
  readonly #panelContainer: HTMLElement;
  readonly pickerContainer: HTMLElement;

  constructor(
    /** Where the time range is, and the auto refresh, which a fixed range turns off. */
    private readonly query: Pick<QueryApi, 'get' | 'set'>,
    private readonly globalState: Memento,
  ) {
    const formElement: HTMLFormElement = html`<form class="d-time-picker__section">
      <div class="d-time-picker__heading">Custom range</div>
      <label class="d-time-picker__label">From ${this.#fromElement}</label>
      <label class="d-time-picker__label">To ${this.#toElement}</label>
      <div class="d-time-picker__hint">e.g. <code>2026-10-29 10:00</code> or <code>now-6h</code></div>
      ${this.#errorElement}
      ${this.#applyButtonElement}
      ${this.#recentSectionContainer}
    </form>`;
    this.#panelContainer = html`<div
      class="d-time-picker__panel"
      role="dialog"
      aria-label="Time range">
      ${formElement}
      <div class="d-time-picker__section">
        ${this.#searchElement}
        <div class="d-time-picker__quick-ranges">${this.#quickRangesContainer}</div>
      </div>
    </div>`;
    this.#panelContainer.hidden = true;
    // one segmented group: the range and what moves it
    const backButtonElement = html`<button
      type="button"
      class="d-button d-button--icon d-segmented__item"
      title="Shift back"
      aria-label="Shift back">${createElement(ChevronLeft, { width: 16, height: 16 })}</button>`;
    const forwardButtonElement = html`<button
      type="button"
      class="d-button d-button--icon d-segmented__item"
      title="Shift forward"
      aria-label="Shift forward">${createElement(ChevronRight, { width: 16, height: 16 })}</button>`;
    const zoomOutButtonElement = html`<button
      type="button"
      class="d-button d-button--icon d-segmented__item"
      title="Zoom out"
      aria-label="Zoom out">${createElement(ZoomOut, { width: 16, height: 16 })}</button>`;

    this.#buttonElement.addEventListener('click', () => (this.#panelContainer.hidden ? this.open() : this.close()));
    formElement.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.#applyCustom();
    });
    this.#searchElement.addEventListener('input', () => this.#showQuickRanges());
    this.#panelContainer.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      this.close();
      this.#buttonElement.focus();
    });
    backButtonElement.addEventListener('click', () => void this.#shift(-1));
    forwardButtonElement.addEventListener('click', () => void this.#shift(1));
    zoomOutButtonElement.addEventListener('click', () => void this.#zoomOut());
    this.pickerContainer = html`<div class="d-time-picker">
      <div class="d-segmented">
        ${this.#buttonElement}
        ${backButtonElement}
        ${forwardButtonElement}
        ${zoomOutButtonElement}
      </div>
      ${this.#panelContainer}
    </div>`;
  }

  show(): void {
    this.#buttonElement.replaceChildren(createElement(Clock, { width: 16, height: 16 }), this.#label(), createElement(ChevronDown, { width: 14, height: 14, class: 'd-time-picker__chevron' }));
    this.#showQuickRanges();
  }

  open(): void {
    const { range, custom } = this.query.get(TIME);
    const [from = '', to = ''] = custom.split(' to ');
    // a range without preset (`90m`) is a Go duration, and as such `now-90m`
    this.#fromElement.value = range === 'custom' ? from : (PRESETS.find((preset) => preset.value === range)?.from ?? `now-${range}`);
    this.#toElement.value = range === 'custom' ? to : 'now';
    this.#searchElement.value = '';
    this.#errorElement.textContent = '';
    this.#showQuickRanges();
    this.#showRecent();
    this.#panelContainer.hidden = false;
    this.#buttonElement.setAttribute('aria-expanded', 'true');
    this.pickerContainer.ownerDocument.addEventListener('pointerdown', this.#onPointerDown);
    this.#fromElement.focus();
  }

  close(): void {
    this.#panelContainer.hidden = true;
    this.#buttonElement.setAttribute('aria-expanded', 'false');
    this.pickerContainer.ownerDocument.removeEventListener('pointerdown', this.#onPointerDown);
  }

  readonly #onPointerDown = (event: PointerEvent) => {
    if (!this.pickerContainer.contains(event.target as Node)) this.close();
  };

  /** What the button says: the preset, or the custom range with its day once (`2026-10-29 10:00 to 12:00`). */
  #label(): string {
    const { range, custom } = this.query.get(TIME);
    if (range !== 'custom') return PRESETS.find((preset) => preset.value === range)?.label ?? `Last ${range}`;
    const [from = '', to = ''] = custom.split(' to ');
    const [fromDay] = from.split(' ');
    const [toDay, toTime] = to.split(' ');
    if (!from.startsWith('now') && !to.startsWith('now') && fromDay === toDay) return `${from} to ${toTime}`;
    return custom;
  }

  #showQuickRanges(): void {
    const search = this.#searchElement.value.trim().toLowerCase();
    this.#quickRangesContainer.replaceChildren(
      ...PRESETS.filter((preset) => preset.label.toLowerCase().includes(search)).map((preset) => {
        const itemElement: HTMLButtonElement = html`<button type="button" class="d-list__item">${preset.label}</button>`;
        itemElement.classList.toggle('d-list__item--active', preset.value === this.query.get(TIME).range);
        itemElement.addEventListener('click', () => {
          this.query.set(TIME, presetRange(preset.value));
          this.close();
        });
        return html`<li>${itemElement}</li>`;
      }),
    );
  }

  /** Applies From / To once the server could read them; else shows its reason ("time \"yesterday\": …"). */
  async #applyCustom(): Promise<void> {
    const from = this.#fromElement.value.trim();
    const to = this.#toElement.value.trim();
    this.#errorElement.textContent = '';
    this.#applyButtonElement.disabled = true;
    try {
      await resolveTimeRange('custom', `${from} to ${to}`);
    } catch (error) {
      this.#errorElement.textContent = error instanceof Error ? error.message : String(error);
      return;
    } finally {
      this.#applyButtonElement.disabled = false;
    }
    if (!to.startsWith('now')) this.#stopAutoRefresh();
    this.query.set(TIME, customRange(from, to));
    const custom = `${from} to ${to}`;
    void this.globalState.update('recent', [custom, ...this.#recentRanges().filter((range) => range !== custom)].slice(0, 3));
    this.close();
  }

  /** The custom ranges applied last, newest first (`now-6h to now-1h`), as stored by an earlier visit. */
  #recentRanges(): string[] {
    const stored = this.globalState.get<unknown>('recent', []);
    return Array.isArray(stored) ? stored.filter((range): range is string => typeof range === 'string') : [];
  }

  /** Lists the recent ranges; picking one applies it as typed into From / To. */
  #showRecent(): void {
    const ranges = this.#recentRanges();
    this.#recentSectionContainer.hidden = ranges.length === 0;
    this.#recentContainer.replaceChildren(
      ...ranges.map((range) => {
        const itemElement: HTMLButtonElement = html`<button type="button" class="d-list__item">${range}</button>`;
        itemElement.addEventListener('click', () => {
          const [from = '', to = ''] = range.split(' to ');
          this.#fromElement.value = from;
          this.#toElement.value = to;
          void this.#applyCustom();
        });
        return html`<li>${itemElement}</li>`;
      }),
    );
  }

  /** Turns auto refresh off, for a fixed range. */
  #stopAutoRefresh(): void {
    this.query.set(REFRESH, undefined);
  }

  /** Moves the window by its length, back (`-1`) or forward (`1`); a moved window is fixed, so auto refresh goes off. */
  async #shift(direction: -1 | 1): Promise<void> {
    const { range, custom } = this.query.get(TIME);
    const { from, to } = await resolveTimeRange(range, custom);
    const by = direction * (to - from);
    this.#stopAutoRefresh();
    this.query.set(TIME, customRange(formatTime(new Date(from + by)), formatTime(new Date(to + by))));
  }

  /**
   * Doubles the window: one ending now stays so, as a preset (`Last 1 hour` → `Last 2h`); a fixed one grows by half its
   * length on each side.
   */
  async #zoomOut(): Promise<void> {
    const { range, custom } = this.query.get(TIME);
    const { from, to } = await resolveTimeRange(range, custom);
    const length = to - from;
    if (range !== 'custom' || custom.endsWith(' to now')) {
      this.query.set(TIME, presetRange(formatGoDuration(2 * length)));
      return;
    }
    this.query.set(TIME, customRange(formatTime(new Date(from - length / 2)), formatTime(new Date(to + length / 2))));
  }
}

/**
 * The quick ranges: `value` a Go duration as the server parses it (time.ParseDuration), `from` the same as the start
 * of a custom range, in the unit people read it in (`now-30d`, not `now-720h`).
 */
const PRESETS = [
  { label: 'Last 5 minutes', value: '5m', from: 'now-5m' },
  { label: 'Last 15 minutes', value: '15m', from: 'now-15m' },
  { label: 'Last 1 hour', value: '1h', from: 'now-1h' },
  { label: 'Last 3 hours', value: '3h', from: 'now-3h' },
  { label: 'Last 6 hours', value: '6h', from: 'now-6h' },
  { label: 'Last 12 hours', value: '12h', from: 'now-12h' },
  { label: 'Last 24 hours', value: '24h', from: 'now-24h' },
  { label: 'Last 2 days', value: '48h', from: 'now-2d' },
  { label: 'Last 7 days', value: '168h', from: 'now-7d' },
  { label: 'Last 30 days', value: '720h', from: 'now-30d' },
];

/** The window a time range stands for now, in ms, as the server resolves it; throws the server's reason when it cannot. */
async function resolveTimeRange(time: string, range: string): Promise<{ from: number; to: number }> {
  const request = new URLSearchParams({ time });
  if (time === 'custom') request.set('range', range);
  const response = await fetch(`/time-range?${request}`);
  if (!response.ok) throw new Error((await response.text()).trim());
  return (await response.json()) as { from: number; to: number };
}

/** `ms` as a Go duration in its largest whole unit, as a preset: `2h`, `90m`, `45s`. */
function formatGoDuration(ms: number): string {
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  return `${Math.round(ms / 1000)}s`;
}
