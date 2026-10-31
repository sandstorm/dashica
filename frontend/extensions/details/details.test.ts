// @vitest-environment jsdom
// Tests for details.ts: the panel showing the records a widget gave by `details.showRecords`, a view per record, the
// status bar; popped out: the records shown then side by side in a tab.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import type { WidgetNode } from '../../generated/zz_generated.dashica';
import type { CommandOptions } from '../../hosts/commands/commands';
import type { ExtensionContext } from '../../hosts/extension-host/extension-host';
import type { PoppedView } from '../../hosts/page/page';
import type { WidgetRecord } from '../../hosts/widgets/widgets';
import { details, drawComparison, drawRecord, recordsSelected } from './details';

let body: HTMLElement;
let status: HTMLElement;
let panel: { visible: boolean; shown: number };
let visibility: EventEmitter<void>;
let commands: Record<string, (...args: any[]) => unknown>;
let popOutEnabled: () => boolean;
let popped: PoppedView[];

beforeEach(() => {
  body = document.body.appendChild(document.createElement('div'));
  panel = { visible: false, shown: 0 };
  visibility = new EventEmitter<void>();
  commands = {};
  popped = [];
  const context = {
    subscriptions: [],
    ui: {
      registerSidePanel: () => ({
        body,
        get visible() {
          return panel.visible;
        },
        onDidChangeVisibility: visibility.event,
        show: () => panel.shown++,
        dispose() {},
      }),
      registerBarItem: (_bar: string, element: HTMLElement) => {
        status = element;
        return { dispose() {} };
      },
      registerMenuItem: () => ({ dispose() {} }),
    },
    page: { popOut: async (view: PoppedView) => void popped.push(view) },
    commands: {
      registerCommand: (id: string, run: () => unknown, options?: CommandOptions) => {
        commands[id] = run;
        if (id === 'details.popOut') popOutEnabled = options!.enablement!;
      },
    },
  };
  details.activate(context as unknown as ExtensionContext);
});

afterEach(() => document.body.replaceChildren());

/** A table titled `title`. */
const tableNode = (title = 'Latest requests', dataUrl = '/p/shop/api/1') => ({ type: 'table', props: { title, height: 500 }, dataUrl }) as WidgetNode;
/** `widget` gives `records`, as a table does on each change of its ticks. */
const show = (widget: WidgetNode, records: readonly WidgetRecord[]) => commands['details.showRecords']({ widget, records });

const showPanel = () => {
  panel.visible = true;
  visibility.fire();
};
const titles = () => [...body.querySelectorAll('.d-view__title')].map((title) => title.textContent);

describe('details', () => {
  it('says in the status bar how many records are shown, hidden while there are none; a click opens the panel', () => {
    expect(status.hidden).toBe(true);
    const table = tableNode();
    show(table, [{ path: '/api' }, { path: '/login' }]);
    expect(status.hidden).toBe(false);
    expect(status.textContent).toBe('2 records selected');
    status.click();
    expect(panel.shown).toBe(1);
    show(table, []);
    expect(status.hidden).toBe(true);
    expect(recordsSelected(1)).toBe('1 record selected');
    expect(recordsSelected(1200)).toBe('1,200 records selected');
  });

  it('shows the giving widget’s title and a view per record, anew on each call', () => {
    showPanel();
    expect(body.textContent).toContain('Tick rows of a table to see them here.');
    const table = tableNode();
    show(table, [{ path: '/api', status: 200 }]);
    expect(body.querySelector('.d-details__title')!.textContent).toBe('Latest requests');
    expect(titles()).toEqual(['Record 1']);
    expect([...body.querySelectorAll('.d-details__key')].map((key) => key.textContent)).toEqual(['path', 'status']);

    show(table, [{ path: '/api' }, { path: '/login' }]);
    expect(titles()).toEqual(['Record 1', 'Record 2']);

    const hosts = tableNode('Hosts', '/p/shop/api/2');
    show(hosts, [{ host: 'web-1' }]);
    expect(body.querySelector('.d-details__title')!.textContent).toBe('Hosts');
    // the first table's ticks cleared (its next answer): the second one's are kept
    show(table, []);
    expect(body.querySelector('.d-details__title')!.textContent).toBe('Hosts');
    expect(status.textContent).toBe('1 record selected');
    show(hosts, []);
    expect(body.textContent).toContain('Tick rows of a table to see them here.');
    expect(status.hidden).toBe(true);
  });

  it('opens every record view anew: a view closed on one selection leaves the next one open', () => {
    showPanel();
    show(tableNode(), [{ path: '/api' }]);
    body.querySelector<HTMLButtonElement>('.d-view__toggle')!.click();
    expect(body.querySelector<HTMLElement>('.d-view__body')!.hidden).toBe(true);
    show(tableNode('Hosts', '/p/shop/api/2'), [{ host: 'web-1' }]);
    expect(body.querySelector<HTMLElement>('.d-view__body')!.hidden).toBe(false);
  });

  it('draws nothing while hidden, and what is shown once the panel is', () => {
    show(tableNode(), [{ path: '/api' }]);
    expect(body.childElementCount).toBe(0);
    showPanel();
    expect(titles()).toEqual(['Record 1']);
  });

  it('pops the records shown out into a tab, side by side, kept when the table clears its ticks', () => {
    expect(popOutEnabled()).toBe(false);
    commands['details.popOut']();
    expect(popped).toEqual([]);
    const table = tableNode();
    show(table, [{ path: '/api', status: 200 }, { path: '/api', status: 500 }]);
    expect(popOutEnabled()).toBe(true);
    commands['details.popOut']();
    expect(popped.map((view) => view.title)).toEqual(['Details: Latest requests']);
    const tab = document.createElement('div');
    popped[0].render(tab);
    show(table, []);
    expect(popOutEnabled()).toBe(false);
    expect([...tab.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual(['Field', 'Record 1', 'Record 2']);
    expect([...tab.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((cell) => cell.textContent))).toEqual([
      ['path', '/api', '/api'],
      ['status', '200', '500'],
    ]);
  });

  it('compares records by field, marks a row whose values differ, leaves a missing field empty', () => {
    const compared = drawComparison('Latest requests', [{ path: '/api', attrs: '{"user":"anna"}' }, { path: '/api', host: 'web-1' }]);
    expect(compared.querySelector('.d-details__title')!.textContent).toBe('Latest requests');
    const rows = [...compared.querySelectorAll('tbody tr')];
    expect(rows.map((row) => row.querySelector('th')!.textContent)).toEqual(['path', 'attrs', 'host']);
    expect(rows.map((row) => row.classList.contains('d-details-compare__row--differs'))).toEqual([false, true, true]);
    expect(rows[1].querySelector('pre')!.textContent).toBe('{\n  "user": "anna"\n}');
    expect(rows[2].querySelectorAll('td')[0].textContent).toBe('');
  });

  it('shows a record’s JSON pretty-printed, a value of several lines as it is, others as text', () => {
    const record = drawRecord({ attrs: '{"user":"anna"}', trace: 'at a\nat b', path: '/api', size: null });
    const values = [...record.querySelectorAll('.d-details__value')];
    expect(values[0].querySelector('pre')!.textContent).toBe('{\n  "user": "anna"\n}');
    expect(values[1].querySelector('pre')!.textContent).toBe('at a\nat b');
    expect(values[2].querySelector('pre')).toBeNull();
    expect(values[2].textContent).toBe('/api');
    expect(values[3].textContent).toBe('null');
  });
});
