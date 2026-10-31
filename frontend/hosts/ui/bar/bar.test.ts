// @vitest-environment jsdom
// Tests for bar.ts (Bar): items by alignment and priority, the bar hidden while it has none (unless it holds a fixed
// part), its items withheld (a popped-out view's tab).
import { describe, expect, it } from 'vitest';
import { Bar } from './bar';

const item = (text: string) => Object.assign(document.createElement('span'), { textContent: text });
const shown = (el: Element) => !el.closest('[hidden]');

describe('Bar', () => {
  it('puts the items by alignment, the higher priority further left', () => {
    const region = document.createElement('div');
    const bar = new Bar(region);
    bar.add(item('a'), { alignment: 'right' });
    bar.add(item('b'), { alignment: 'right', priority: 10 });
    bar.add(item('c'), { alignment: 'left' });
    expect(region.querySelector('.d-workbench__bar-right')!.textContent).toBe('ba');
    expect(region.querySelector('.d-workbench__bar-left')!.textContent).toBe('c');
  });

  it('is hidden while it has no item', () => {
    const region = document.createElement('div');
    const bar = new Bar(region);
    expect(region.hidden).toBe(true);
    const added = bar.add(item('a'), { alignment: 'left' });
    expect(region.hidden).toBe(false);
    added.dispose();
    expect(region.hidden).toBe(true);
  });

  it('hides its items while withheld, also those added meanwhile, and shows them again after', () => {
    const region = document.createElement('div');
    const bar = new Bar(region);
    const first = item('a');
    bar.add(first, { alignment: 'left' });
    bar.withhold(true);
    const second = item('b');
    bar.add(second, { alignment: 'right' });
    expect(region.hidden).toBe(true);
    bar.withhold(false);
    expect(region.hidden).toBe(false);
    expect(shown(first) && shown(second)).toBe(true);
  });

  it('keeps its fixed part shown while its items are withheld', () => {
    const region = document.createElement('div');
    const tabs = item('tabs');
    const bar = new Bar(region, tabs);
    const range = item('range');
    bar.add(range, { alignment: 'right' });
    bar.withhold(true);
    expect(shown(tabs)).toBe(true);
    expect(shown(range)).toBe(false);
  });
});
