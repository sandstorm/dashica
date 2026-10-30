// @vitest-environment jsdom
// Tests for chart-link.ts: the entry in a chart's menu, the link it copies.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MenuItem } from '../../hosts/commands/commands';
import type { ExtensionContext } from '../../hosts/extension-host/extension-host';
import type { WidgetMenuContext } from '../../hosts/widgets/widgets';
import { chartLink } from './chart-link';

let item: MenuItem<WidgetMenuContext>;
let copy: (widget: WidgetMenuContext) => Promise<void>;
let copied: string[];

beforeEach(() => {
  history.replaceState(null, '', '/p/shop?time=1h');
  copied = [];
  vi.stubGlobal('navigator', { clipboard: { writeText: async (text: string) => void copied.push(text) } });
  const context = {
    subscriptions: [],
    ui: { registerMenuItem: (_menuId: string, registered: typeof item) => (item = registered) },
    commands: { registerCommand: (_id: string, run: typeof copy) => (copy = run) },
  };
  chartLink.activate(context as unknown as ExtensionContext);
});

afterEach(() => vi.unstubAllGlobals());

const menuOf = (widget: WidgetMenuContext['widget']): WidgetMenuContext => ({ widget, url: (path) => path, lastResult: undefined });
const chart = menuOf({ type: 'table', props: {}, dataUrl: '/p/shop/api/shop_orders' });

describe('chartLink', () => {
  it('is in the menu of a widget with data only', () => {
    expect(item.title).toBe('Copy link to chart');
    expect(item.when!(chart)).toBe(true);
    expect(item.when!(menuOf({ type: 'markdown', props: { html: '' } }))).toBe(false);
  });

  it('copies the absolute link to the chart on the page shown', async () => {
    await copy(chart);
    expect(copied).toEqual([`${location.origin}/p/shop#w=shop_orders`]);
  });
});
