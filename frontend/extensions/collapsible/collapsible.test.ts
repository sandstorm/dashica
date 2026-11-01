// @vitest-environment jsdom
// Tests for collapsible.ts: the title and widget count, open or closed at first, the widgets in their order.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WidgetNode } from '../../generated/zz_generated.dashica';
import { settle, widgetTestbed } from '../../hosts/widgets/widgets-testing';
import { schemaTable } from '../schema-table/schema-table';
import { collapsible } from './collapsible';

let testbed: ReturnType<typeof widgetTestbed>;

beforeEach(() => {
  testbed = widgetTestbed();
  testbed.activate(collapsible, schemaTable);
});

afterEach(() => testbed.dispose());

const table = (n: number): WidgetNode => ({ type: 'schemaTable', props: { table: `t${n}` }, dataUrl: `/p/shop/api/${n}` });

describe('collapsible', () => {
  it('shows its widgets in their order below its title', async () => {
    for (const n of [1, 2, 10]) testbed.serveText(`/p/shop/api/${n}/schema`, `CREATE TABLE t${n}`);
    const { widgetContainer } = testbed.render({ type: 'collapsibleGroup', props: { title: 'Details', open: true }, children: { '10': table(10), '0': table(1), '2': table(2) } });
    await settle();
    const groupContainer = widgetContainer.querySelector('details')!;
    expect(groupContainer.open).toBe(true);
    expect(groupContainer.querySelector('summary span')!.textContent).toBe('Details');
    expect(groupContainer.querySelector('summary .d-collapsible__count')!.textContent).toBe('· 3 widgets');
    expect([...groupContainer.querySelectorAll('pre')].map((preElement) => preElement.textContent)).toEqual(['CREATE TABLE t1', 'CREATE TABLE t2', 'CREATE TABLE t10']);
  });

  it('starts closed unless it says open', () => {
    const { widgetContainer } = testbed.render({ type: 'collapsibleGroup', props: { title: 'Details' } });
    expect(widgetContainer.querySelector('details')!.open).toBe(false);
  });
});
