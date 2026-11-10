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

let bodyContainer: HTMLElement;
let statusElement: HTMLElement;
let panel: { visible: boolean; shown: number; nudged: number };
let visibility: EventEmitter<void>;
let commands: Record<string, (...args: any[]) => unknown>;
let popOutEnabled: () => boolean;
let popped: PoppedView[];

beforeEach(() => {
  bodyContainer = document.body.appendChild(document.createElement('div'));
  panel = { visible: false, shown: 0, nudged: 0 };
  visibility = new EventEmitter<void>();
  commands = {};
  popped = [];
  const context = {
    subscriptions: [],
    ui: {
      registerSidePanel: () => ({
        bodyContainer,
        get visible() {
          return panel.visible;
        },
        onDidChangeVisibility: visibility.event,
        show: () => panel.shown++,
        nudge: () => panel.nudged++,
        dispose() {},
      }),
      registerBarItem: (_bar: string, itemElement: HTMLElement) => {
        statusElement = itemElement;
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

const tableNode = (title = 'Latest requests', dataUrl = '/p/shop/api/1') => ({ type: 'table', props: { title, height: 500 }, dataUrl }) as WidgetNode;
/** `widget` gives `records`, as a table does on each change of its ticks. */
const show = (widget: WidgetNode, records: readonly WidgetRecord[]) => commands['details.showRecords']({ widget, records });

const showPanel = () => {
  panel.visible = true;
  visibility.fire();
};
const titles = () => [...bodyContainer.querySelectorAll('.d-view__title')].map((titleElement) => titleElement.textContent);

describe('details', () => {
  it('nudges the panel on each call with records, none when they clear', () => {
    const table = tableNode();
    show(table, [{ path: '/api' }]);
    show(table, [{ path: '/api' }, { path: '/login' }]);
    show(table, []);
    expect(panel.nudged).toBe(2);
  });

  it('says in the status bar how many records are shown, hidden while there are none; a click opens the panel', () => {
    expect(statusElement.hidden).toBe(true);
    const table = tableNode();
    show(table, [{ path: '/api' }, { path: '/login' }]);
    expect(statusElement.hidden).toBe(false);
    expect(statusElement.textContent).toBe('2 records selected');
    statusElement.click();
    expect(panel.shown).toBe(1);
    show(table, []);
    expect(statusElement.hidden).toBe(true);
    expect(recordsSelected(1)).toBe('1 record selected');
    expect(recordsSelected(1200)).toBe('1,200 records selected');
  });

  it('shows the giving widget’s title and a view per record, anew on each call', () => {
    showPanel();
    expect(bodyContainer.textContent).toContain('Tick rows of a table to see them here.');
    const table = tableNode();
    show(table, [{ path: '/api', status: 200 }]);
    expect(bodyContainer.querySelector('.d-details__title')!.textContent).toBe('Latest requests');
    expect(titles()).toEqual(['Record 1']);
    expect([...bodyContainer.querySelectorAll('.d-details__key')].map((keyElement) => keyElement.textContent)).toEqual(['path', 'status']);

    show(table, [{ path: '/api' }, { path: '/login' }]);
    expect(titles()).toEqual(['Record 1', 'Record 2']);

    const hosts = tableNode('Hosts', '/p/shop/api/2');
    show(hosts, [{ host: 'web-1' }]);
    expect(bodyContainer.querySelector('.d-details__title')!.textContent).toBe('Hosts');
    // the first table's ticks cleared (its next answer): the second one's are kept
    show(table, []);
    expect(bodyContainer.querySelector('.d-details__title')!.textContent).toBe('Hosts');
    expect(statusElement.textContent).toBe('1 record selected');
    show(hosts, []);
    expect(bodyContainer.textContent).toContain('Tick rows of a table to see them here.');
    expect(statusElement.hidden).toBe(true);
  });

  it('opens every record view anew: a view closed on one selection leaves the next one open', () => {
    showPanel();
    show(tableNode(), [{ path: '/api' }]);
    bodyContainer.querySelector<HTMLButtonElement>('.d-view__toggle')!.click();
    expect(bodyContainer.querySelector<HTMLElement>('.d-view__body')!.hidden).toBe(true);
    show(tableNode('Hosts', '/p/shop/api/2'), [{ host: 'web-1' }]);
    expect(bodyContainer.querySelector<HTMLElement>('.d-view__body')!.hidden).toBe(false);
  });

  it('draws nothing while hidden, and what is shown once the panel is', () => {
    show(tableNode(), [{ path: '/api' }]);
    expect(bodyContainer.childElementCount).toBe(0);
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
    const tabElement = document.createElement('div');
    popped[0].render(tabElement);
    show(table, []);
    expect(popOutEnabled()).toBe(false);
    expect([...tabElement.querySelectorAll('thead th')].map((thElement) => thElement.textContent)).toEqual(['Field', 'Record 1', 'Record 2']);
    expect([...tabElement.querySelectorAll('tbody tr')].map((trElement) => [...trElement.children].map((cellElement) => cellElement.textContent))).toEqual([
      ['path', '/api', '/api'],
      ['status', '200', '500'],
    ]);
  });

  it('compares records by field, marks a row whose values differ, leaves a missing field empty', () => {
    const comparisonElement = drawComparison('Latest requests', [{ path: '/api', attrs: '{"user":"anna"}' }, { path: '/api', host: 'web-1' }]);
    expect(comparisonElement.querySelector('.d-details__title')!.textContent).toBe('Latest requests');
    const rowElements = [...comparisonElement.querySelectorAll('tbody tr')];
    expect(rowElements.map((rowElement) => rowElement.querySelector('th')!.textContent)).toEqual(['path', 'attrs', 'host']);
    expect(rowElements.map((rowElement) => rowElement.classList.contains('d-details-compare__row--differs'))).toEqual([false, true, true]);
    expect(rowElements[1].querySelector('pre')!.textContent).toBe('{\n  "user": "anna"\n}');
    expect(rowElements[2].querySelectorAll('td')[0].textContent).toBe('');
  });

  it('shows a record’s JSON pretty-printed, a value of several lines as it is, others as text', () => {
    const recordElement = drawRecord({ attrs: '{"user":"anna"}', trace: 'at a\nat b', path: '/api', size: null });
    const valueElements = [...recordElement.querySelectorAll('.d-details__value')];
    expect(valueElements[0].querySelector('pre')!.textContent).toBe('{\n  "user": "anna"\n}');
    expect(valueElements[1].querySelector('pre')!.textContent).toBe('at a\nat b');
    expect(valueElements[2].querySelector('pre')).toBeNull();
    expect(valueElements[2].textContent).toBe('/api');
    expect(valueElements[3].textContent).toBe('null');
  });
});
