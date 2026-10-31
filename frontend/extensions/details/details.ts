import { html } from 'htl';
import { ListChecks, createElement } from 'lucide';
import type { Extension, Memento } from '../../hosts/extension-host/extension-host';
import { createView } from '../../hosts/ui/ui';
import { widgetTitle, type ActiveWidget, type WidgetRecord } from '../../hosts/widgets/widgets';
import { tryPrettyJson } from '../chart-library/table';
import './details.css';

/**
 * The left side panel "Details" and the status bar's item, both about the active widget's selected records
 * (`widgets.active.records`: a table's ticked rows). The panel shows the widget's title, then a view per record, its
 * fields one below the other (a JSON value pretty-printed, a value of several lines as it is), drawn anew when the
 * records or the active widget change; the views' collapsed state in the extension's `workspaceState`. The status bar
 * says "3 records selected" while there are some; a click on it opens the panel.
 */
export const details: Extension = {
  id: 'details',
  activate({ ui, widgets, workspaceState, subscriptions }) {
    const panel = ui.registerSidePanel('details', { label: 'Details', icon: createElement(ListChecks).outerHTML, order: 20 });
    const status: HTMLButtonElement = html`<button type="button" class="d-details-status" data-testid="details-status" title="Show Details" onclick=${() => panel.show()}></button>`;
    subscriptions.push(panel, ui.registerBarItem('status', status, { alignment: 'left' }));

    /** What the panel shows, to draw it only when that changes. */
    let shown: Pick<ActiveWidget, 'widget' | 'records'> | undefined;
    const update = () => {
      const active = widgets.active;
      const records = active?.records ?? [];
      status.hidden = records.length === 0;
      status.textContent = recordsSelected(records.length);
      if (!panel.visible) {
        shown = undefined;
        return;
      }
      if (shown && active && shown.widget === active.widget && shown.records === active.records) return;
      shown = active && { widget: active.widget, records: active.records };
      panel.body.replaceChildren(drawDetails(active, workspaceState));
    };
    update();
    subscriptions.push(widgets.onDidChangeActive(update), panel.onDidChangeVisibility(update));
  },
};

/** "1 record selected", "3 records selected". */
export function recordsSelected(count: number): string {
  return `${count.toLocaleString('en')} ${count === 1 ? 'record' : 'records'} selected`;
}

/** The panel's content for `active`: its title and a view per record (their state in `state`), else a hint. */
function drawDetails(active: ActiveWidget | undefined, state: Memento): HTMLElement {
  if (!active || active.records.length === 0) return html`<div class="d-details__hint">Tick rows of a table to see them here.</div>`;
  return html`<div class="d-details">
    <h2 class="d-details__title">${widgetTitle(active.widget)}</h2>
    ${active.records.map((record, i) => createView({ id: `record.${i}`, title: `Record ${i + 1}`, state, body: drawRecord(record) }))}
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
