import { html } from 'htl';
import { ListChecks, SquareArrowOutUpRight, createElement } from 'lucide';
import { Disposable } from '../../core/disposable/disposable';
import type { WidgetNode } from '../../generated/zz_generated.dashica';
import type { Extension } from '../../hosts/extension-host/extension-host';
import { createView } from '../../hosts/ui/ui';
import type { WidgetRecord } from '../../hosts/widgets/widgets';
import { tryPrettyJson } from '../chart-library/table';
import { widgetTitle } from '../widget-library/widget-title';
import './details.css';

/**
 * The left side panel "Details" and the status bar's item, both about the records a widget gave last by the command
 * `details.showRecords` (`{ widget, records }`: a table runs it on each change of its ticked rows), kept here; a call
 * without records clears them when they are that widget's, and leaves another widget's. The panel shows the widget's
 * title, then a view per record, its fields one below the other (a JSON value pretty-printed, a value of several lines
 * as it is), drawn anew on each call, each view starting open. "Pop out" (the panel's menu `panel/details`, enabled
 * while records are shown) opens a tab comparing the records kept then side by side, a column per record, which keeps
 * them when the table's next answer clears its ticks. While the panel is hidden, each call with records nudges its
 * rail button (`Panel.nudge`). The status bar says "3 records selected" while there are some, and is hidden while
 * there are none; a click on it opens the panel.
 */
export const details: Extension = {
  id: 'details',
  activate({ ui, page, commands, subscriptions }) {
    const panel = ui.registerSidePanel('details', { label: 'Details', icon: createElement(ListChecks).outerHTML, order: 20 });
    const statusElement: HTMLButtonElement = html`<button type="button" class="d-details-status" data-testid="details-status" title="Show Details" onclick=${() => panel.show()}></button>`;
    subscriptions.push(panel, ui.registerBarItem('status', statusElement, { alignment: 'left' }));

    /** The records shown, with the widget that gave them; `undefined` while none. */
    let shown: ShownRecords | undefined;
    const update = () => {
      statusElement.textContent = recordsSelected(shown?.records.length ?? 0);
      statusElement.hidden = !shown;
      if (panel.visible) panel.bodyContainer.replaceChildren(drawDetails(shown));
    };
    update();
    subscriptions.push(
      panel.onDidChangeVisibility(update),
      commands.registerCommand('details.showRecords', (given: ShownRecords) => {
        if (given.records.length === 0 && shown && shown.widget !== given.widget) return;
        shown = given.records.length > 0 ? given : undefined;
        update();
        if (shown) panel.nudge();
      }),
      commands.registerCommand(
        'details.popOut',
        () => {
          if (!shown) return;
          const title = widgetTitle(shown.widget);
          const { records } = shown;
          return page.popOut({
            title: `Details: ${title}`,
            // the tab's element is emptied when it closes
            render: (viewContainer) => (viewContainer.append(drawComparison(title, records)), Disposable.from()),
          });
        },
        { enablement: () => shown !== undefined, disabledReason: 'No records selected' },
      ),
      ui.registerMenuItem('panel/details', { command: 'details.popOut', title: 'Pop out', icon: createElement(SquareArrowOutUpRight).outerHTML }),
    );
  },
};

/** "1 record selected", "3 records selected". */
export function recordsSelected(count: number): string {
  return `${count.toLocaleString('en')} ${count === 1 ? 'record' : 'records'} selected`;
}

/** `record`'s fields, one below the other. */
export function drawRecord(record: WidgetRecord): HTMLElement {
  return html`<dl class="d-details__record">
    ${Object.entries(record).map(
      ([key, value]) => html`<div class="d-details__field">
        <dt class="d-details__key">${key}</dt>
        <dd class="d-details__value">${drawValue(value)}</dd>
      </div>`,
    )}
  </dl>`;
}

/**
 * `records` side by side under the widget's `title`: a row per field (in the order the records first have them), a
 * column per record; a row whose values differ is marked (`d-details-compare__row--differs`), a missing field is empty.
 */
export function drawComparison(title: string, records: readonly WidgetRecord[]): HTMLElement {
  const keys = [...new Set(records.flatMap((record) => Object.keys(record)))];
  return html`<div class="d-details-compare">
    <h2 class="d-details__title">${title}</h2>
    <table class="d-details-compare__table">
      <thead><tr><th scope="col">Field</th>${records.map((_, i) => html`<th scope="col">Record ${i + 1}</th>`)}</tr></thead>
      <tbody>
        ${keys.map((key) => {
          const texts = records.map((record) => (key in record ? String(record[key]) : undefined));
          const differs = new Set(texts).size > 1;
          return html`<tr class=${differs ? 'd-details-compare__row--differs' : ''}>
            <th scope="row" class="d-details__key">${key}</th>
            ${records.map((record) => html`<td class="d-details__value">${key in record ? drawValue(record[key]) : ''}</td>`)}
          </tr>`;
        })}
      </tbody>
    </table>
  </div>`;
}

/** The argument of `details.showRecords`: the widget the records are of, and its records (empty: it has none now). */
interface ShownRecords {
  readonly widget: WidgetNode;
  readonly records: readonly WidgetRecord[];
}

/** The panel's content for `shown`: its widget's title and a view per record, each open, else a hint. */
function drawDetails(shown: ShownRecords | undefined): HTMLElement {
  if (!shown) return html`<div class="d-details__hint">Tick rows of a table to see them here.</div>`;
  return html`<div class="d-details">
    <h2 class="d-details__title">${widgetTitle(shown.widget)}</h2>
    ${shown.records.map((record, i) => createView({ id: `record.${i}`, title: `Record ${i + 1}`, body: drawRecord(record) }))}
  </div>`;
}

/** A field's value: a JSON value pretty-printed, a value of several lines as it is, others as text. */
function drawValue(value: unknown): Node | string {
  const text = String(value);
  const block = tryPrettyJson(text) ?? (text.trim().includes('\n') ? text : null);
  return block === null ? text : html`<pre class="d-details__block">${block}</pre>`;
}
