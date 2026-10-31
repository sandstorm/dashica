// @vitest-environment jsdom
// Tests for tab-bar.ts (TabBar): a tab per open page, the shown one selected, choosing and closing (×, middle click),
// no × on the last tab.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TabBar } from './tab-bar';

let container: HTMLElement;
let bar: TabBar;
let chosen: string[];
let closed: string[];

beforeEach(() => {
  container = document.body.appendChild(document.createElement('div'));
  chosen = [];
  closed = [];
  bar = new TabBar(container, { onDidChoose: (id) => chosen.push(id), onDidClose: (id) => closed.push(id) });
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

const tabs = () => [...container.querySelectorAll<HTMLButtonElement>('[role=tab]')];

describe('TabBar', () => {
  it('shows a tab per page in a tab list, the shown one selected', () => {
    expect(container.querySelector('[role=tablist]')!.getAttribute('aria-label')).toBe('Open pages');
    expect(tabs().map((tab) => [tab.textContent, tab.getAttribute('aria-selected')])).toEqual([
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
    container.querySelector<HTMLButtonElement>('[aria-label="Close Shop"]')!.click();
    tabs()[1].dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    expect(closed).toEqual(['a', 'b']);
    expect(chosen).toEqual([]);
  });

  it('has no × on the last tab, and a middle click leaves it open', () => {
    bar.update([{ id: 'a', title: 'Shop' }], 'a');
    expect(container.querySelector('.d-workbench__tab-close')).toBeNull();
    tabs()[0].dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    expect(closed).toEqual([]);
  });

  it('takes its tab list out of the container when disposed', () => {
    bar.dispose();
    expect(container.children).toHaveLength(0);
  });
});
