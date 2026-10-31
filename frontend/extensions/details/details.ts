import { html } from 'htl';
import { ListChecks, createElement } from 'lucide';
import type { Extension } from '../../hosts/extension-host/extension-host';
import { createView, registerBarItemWhile } from '../../hosts/ui/ui';
import { widgetTitle, type ActiveWidget, type WidgetRecord } from '../../hosts/widgets/widgets';
import { tryPrettyJson } from '../chart-library/table';
import './details.css';

/**
 * The left side panel "Details" and the status bar's item, both about the active widget's selected records
 * (`widgets.active.records`: a table's ticked rows). The panel shows the widget's title, then a view per record, its
 * fields one below the other (a JSON value pretty-printed, a value of several lines as it is), drawn anew when the
 * records or the active widget change; each view starts open, its collapsed state not kept (a place in one selection
 * says nothing about another's). The status bar says "3 records selected" while there are some (else the item is not
 * in it, so the start page has no status bar); a click on it opens the panel.
 */
export const details: Extension = {
  id: 'details',
  activate({ ui, widgets, subscriptions }) {
    const panel = ui.registerSidePanel('details', { label: 'Details', icon: createElement(ListChecks).outerHTML, order: 20 });
    const status: HTMLButtonElement = html`<button type="button" class="d-details-status" data-testid="details-status" title="Show Details" onclick=${() => panel.show()}></button>`;
    const selected = () => (widgets.active?.records.length ?? 0) > 0;
    subscriptions.push(panel, registerBarItemWhile(ui, 'status', status, { alignment: 'left' }, widgets.onDidChangeActive, selected));

    /** What the panel shows, to draw it only when that changes. */
    let shown: Pick<ActiveWidget, 'widget' | 'records'> | undefined;
    const update = () => {
      const active = widgets.active;
      const records = active?.records ?? [];
      status.textContent = recordsSelected(records.length);
      if (!panel.visible) {
        shown = undefined;
        return;
      }
      if (shown && active && shown.widget === active.widget && shown.records === active.records) return;
      shown = active && { widget: active.widget, records: active.records };
      panel.body.replaceChildren(drawDetails(active));
    };
    update();
    subscriptions.push(widgets.onDidChangeActive(update), panel.onDidChangeVisibility(update));
  },
};

/** "1 record selected", "3 records selected". */
export function recordsSelected(count: number): string {
  return `${count.toLocaleString('en')} ${count === 1 ? 'record' : 'records'} selected`;
}

/** The panel's content for `active`: its title and a view per record, each open, else a hint. */
function drawDetails(active: ActiveWidget | undefined): HTMLElement {
  if (!active || active.records.length === 0) return html`<div class="d-details__hint">Tick rows of a table to see them here.</div>`;
  return html`<div class="d-details">
    <h2 class="d-details__title">${widgetTitle(active.widget)}</h2>
    ${active.records.map((record, i) => createView({ id: `record.${i}`, title: `Record ${i + 1}`, body: drawRecord(record) }))}
  </div>`;
}

/** `record`'s fields, one below the other: a JSON value pretty-printed, a value of several lines as it is. */
export function drawRecord(record: WidgetRecord): HTMLElement {
  return html`<dl class="d-details__record">
    ${Object.entries(record).map(([key, value]) => {
      const text = String(value);
      const block = tryPrettyJson(text) ?? (text.trim().includes('\n') ? text : null);
      return html`<div class="d-details__field">
        <dt class="d-details__key">${key}</dt>
        <dd class="d-details__value">${block === null ? text : html`<pre class="d-details__block">${block}</pre>`}</dd>
      </div>`;
    })}
  </dl>`;
}
