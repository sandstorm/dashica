// @vitest-environment jsdom
// Tests for details.ts: the panel following the active widget's selected records, a view per record, the status bar.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import type { ExtensionContext } from '../../hosts/extension-host/extension-host';
import type { ActiveWidget, WidgetRecord } from '../../hosts/widgets/widgets';
import { details, drawRecord, recordsSelected } from './details';

let body: HTMLElement;
let status: HTMLElement;
let panel: { visible: boolean; shown: number };
let visibility: EventEmitter<void>;
let activeChanged: EventEmitter<void>;
let active: ActiveWidget | undefined;

beforeEach(() => {
  body = document.body.appendChild(document.createElement('div'));
  panel = { visible: false, shown: 0 };
  visibility = new EventEmitter<void>();
  activeChanged = new EventEmitter<void>();
  active = undefined;
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
      registerBarItem: (_bar: string, element: HTMLElement) => (status = element),
    },
    widgets: {
      get active() {
        return active;
      },
      onDidChangeActive: activeChanged.event,
    },
  };
  details.activate(context as unknown as ExtensionContext);
});

afterEach(() => document.body.replaceChildren());

function table(records: readonly WidgetRecord[], title = 'Latest requests'): ActiveWidget {
  return {
    widget: { type: 'table', props: { title, height: 500 }, dataUrl: '/p/shop/api/1' } as ActiveWidget['widget'],
    url: (path) => `/p/shop/api/1${path}`,
    lastResult: undefined,
    status: { kind: 'done', rows: 2, ms: 5, diagnostics: {} },
    records,
  };
}

const showPanel = () => {
  panel.visible = true;
  visibility.fire();
};
const titles = () => [...body.querySelectorAll('.d-view__title')].map((title) => title.textContent);

describe('details', () => {
  it('says in the status bar how many records are selected, only while there are some; a click opens the panel', () => {
    expect(status.hidden).toBe(true);
    active = table([{ path: '/api' }, { path: '/login' }]);
    activeChanged.fire();
    expect(status.hidden).toBe(false);
    expect(status.textContent).toBe('2 records selected');
    status.click();
    expect(panel.shown).toBe(1);
    active = table([]);
    activeChanged.fire();
    expect(status.hidden).toBe(true);
    expect(recordsSelected(1)).toBe('1 record selected');
    expect(recordsSelected(1200)).toBe('1,200 records selected');
  });

  it('shows the active widget’s title and a view per record, and follows the records and the widget', () => {
    showPanel();
    expect(body.textContent).toContain('Tick rows of a table to see them here.');
    active = table([{ path: '/api', status: 200 }]);
    activeChanged.fire();
    expect(body.querySelector('.d-details__title')!.textContent).toBe('Latest requests');
    expect(titles()).toEqual(['Record 1']);
    expect([...body.querySelectorAll('.d-details__key')].map((key) => key.textContent)).toEqual(['path', 'status']);

    active = table([{ path: '/api' }, { path: '/login' }]);
    activeChanged.fire();
    expect(titles()).toEqual(['Record 1', 'Record 2']);
    // its query running again: drawn as it is
    const drawn = body.firstElementChild;
    active = { ...active, status: { kind: 'loading' } };
    activeChanged.fire();
    expect(body.firstElementChild).toBe(drawn);

    active = table([{ host: 'web-1' }], 'Hosts');
    activeChanged.fire();
    expect(body.querySelector('.d-details__title')!.textContent).toBe('Hosts');
    active = undefined;
    activeChanged.fire();
    expect(body.textContent).toContain('Tick rows of a table to see them here.');
  });

  it('opens every record view anew: a view closed on one selection leaves the next one open', () => {
    showPanel();
    active = table([{ path: '/api' }]);
    activeChanged.fire();
    body.querySelector<HTMLButtonElement>('.d-view__toggle')!.click();
    expect(body.querySelector<HTMLElement>('.d-view__body')!.hidden).toBe(true);
    active = table([{ host: 'web-1' }], 'Hosts');
    activeChanged.fire();
    expect(body.querySelector<HTMLElement>('.d-view__body')!.hidden).toBe(false);
  });

  it('draws nothing while hidden, and what is selected once shown', () => {
    active = table([{ path: '/api' }]);
    activeChanged.fire();
    expect(body.childElementCount).toBe(0);
    showPanel();
    expect(titles()).toEqual(['Record 1']);
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
