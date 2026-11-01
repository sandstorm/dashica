// @vitest-environment jsdom
// Tests for tab-bar.ts (TabBar): a tab per open page, the shown one selected, choosing and closing (×, middle click),
// no × on the last tab, "+" asking for a new one; the next and previous tab (adjacentTab).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TabBar, adjacentTab } from './tab-bar';

let tabBarContainer: HTMLElement;
let bar: TabBar;
let chosen: string[];
let closed: string[];
let added: number;

beforeEach(() => {
  tabBarContainer = document.body.appendChild(document.createElement('div'));
  chosen = [];
  closed = [];
  added = 0;
  bar = new TabBar(tabBarContainer, { onDidChoose: (id) => chosen.push(id), onDidClose: (id) => closed.push(id), onDidAdd: () => added++ });
  bar.update(
    [
      { id: 'a', title: 'Shop' },
      { id: 'b', title: 'Explore: Requests' },
    ],
    'b',
  );
});

afterEach(() => {
  bar.dispose();
  document.body.replaceChildren();
});

const tabs = () => [...tabBarContainer.querySelectorAll<HTMLButtonElement>('[role=tab]')];

describe('TabBar', () => {
  it('shows a tab per page in a tab list, the shown one selected', () => {
    expect(tabBarContainer.querySelector('[role=tablist]')!.getAttribute('aria-label')).toBe('Open pages');
    expect(tabs().map((tabElement) => [tabElement.textContent, tabElement.getAttribute('aria-selected')])).toEqual([
      ['Shop', 'false'],
      ['Explore: Requests', 'true'],
    ]);
  });

  it('asks for another tab when it is chosen, not for the one shown', () => {
    tabs()[1].click();
    tabs()[0].click();
    expect(chosen).toEqual(['a']);
  });

  it('asks to close a tab by its × or a middle click, without choosing it', () => {
    tabBarContainer.querySelector<HTMLButtonElement>('[aria-label="Close Shop"]')!.click();
    tabs()[1].dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    expect(closed).toEqual(['a', 'b']);
    expect(chosen).toEqual([]);
  });

  it('has no × on the last tab, and a middle click leaves it open', () => {
    bar.update([{ id: 'a', title: 'Shop' }], 'a');
    expect(tabBarContainer.querySelector('.d-workbench__tab-close')).toBeNull();
    tabs()[0].dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    expect(closed).toEqual([]);
  });

  it('asks for a new tab by "+", after the tabs, without choosing one', () => {
    const addButtonElement = tabBarContainer.querySelector<HTMLButtonElement>('[aria-label="New tab"]')!;
    expect(tabBarContainer.lastElementChild).toBe(addButtonElement);
    addButtonElement.click();
    expect(added).toBe(1);
    expect(chosen).toEqual([]);
  });

  it('takes its tab list and "+" out of the container when disposed', () => {
    bar.dispose();
    expect(tabBarContainer.children).toHaveLength(0);
  });
});

describe('adjacentTab', () => {
  it('names the next and the previous tab, round the end', () => {
    const tabs = ['shop', 'billing', 'checkout'].map((id) => ({ id, url: `/p/${id}`, title: id }));
    expect(adjacentTab(tabs, 'checkout', 1)).toBe('shop');
    expect(adjacentTab(tabs, 'shop', -1)).toBe('checkout');
    expect(adjacentTab(tabs, 'shop', 1)).toBe('billing');
  });
});
