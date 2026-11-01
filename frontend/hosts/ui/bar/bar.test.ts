// @vitest-environment jsdom
// Tests for bar.ts (Bar): items by alignment and priority, the bar hidden while it has none (unless it holds a fixed
// part), its items withheld (a popped-out view's tab).
import { describe, expect, it } from 'vitest';
import { Bar } from './bar';

const item = (text: string) => Object.assign(document.createElement('span'), { textContent: text });
const shown = (itemElement: Element) => !itemElement.closest('[hidden]');

describe('Bar', () => {
  it('puts the items by alignment, the higher priority further left', () => {
    const regionContainer = document.createElement('div');
    const bar = new Bar(regionContainer);
    bar.add(item('a'), { alignment: 'right' });
    bar.add(item('b'), { alignment: 'right', priority: 10 });
    bar.add(item('c'), { alignment: 'left' });
    expect(regionContainer.querySelector('.d-workbench__bar-right')!.textContent).toBe('ba');
    expect(regionContainer.querySelector('.d-workbench__bar-left')!.textContent).toBe('c');
  });

  it('is hidden while it has no item', () => {
    const regionContainer = document.createElement('div');
    const bar = new Bar(regionContainer);
    expect(regionContainer.hidden).toBe(true);
    const added = bar.add(item('a'), { alignment: 'left' });
    expect(regionContainer.hidden).toBe(false);
    added.dispose();
    expect(regionContainer.hidden).toBe(true);
  });

  it('hides its items while withheld, also those added meanwhile, and shows them again after', () => {
    const regionContainer = document.createElement('div');
    const bar = new Bar(regionContainer);
    const firstElement = item('a');
    bar.add(firstElement, { alignment: 'left' });
    bar.withhold(true);
    const secondElement = item('b');
    bar.add(secondElement, { alignment: 'right' });
    expect(regionContainer.hidden).toBe(true);
    bar.withhold(false);
    expect(regionContainer.hidden).toBe(false);
    expect(shown(firstElement) && shown(secondElement)).toBe(true);
  });

  it('keeps its fixed part shown while its items are withheld', () => {
    const regionContainer = document.createElement('div');
    const tabsElement = item('tabs');
    const bar = new Bar(regionContainer, tabsElement);
    const rangeElement = item('range');
    bar.add(rangeElement, { alignment: 'right' });
    bar.withhold(true);
    expect(shown(tabsElement)).toBe(true);
    expect(shown(rangeElement)).toBe(false);
  });
});
