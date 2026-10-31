// @vitest-environment jsdom
// Tests for createView: the header as a button that opens and closes the body (click, ArrowLeft / ArrowRight), the
// description while closed, the actions, and the state kept in the memento for the view drawn anew, or not kept.
import { afterEach, describe, expect, it } from 'vitest';
import { StorageMemento } from '../../extension-host/extension-host';
import { createView, type ViewOptions } from './view';

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

const state = () => StorageMemento.of(document, 'localStorage', 'dashica:global:test:');
const draw = (options: Partial<ViewOptions> = {}) =>
  document.body.appendChild(createView({ id: 'favorites', title: 'Favorites', description: '2', state: state(), body: document.createTextNode('the entries'), ...options }));
const toggle = (view: HTMLElement) => view.querySelector<HTMLButtonElement>('.d-view__toggle')!;
const body = (view: HTMLElement) => view.querySelector<HTMLElement>('.d-view__body')!;

describe('createView', () => {
  it('shows its title as a heading button that controls its open body', () => {
    const view = draw();
    expect(view.querySelector('h2 > button.d-view__toggle .d-view__title')!.textContent).toBe('Favorites');
    expect(toggle(view).getAttribute('aria-expanded')).toBe('true');
    expect(toggle(view).getAttribute('aria-controls')).toBe(body(view).id);
    expect(body(view).id).toMatch(/^d-view-\d+$/);
    expect(body(draw()).id).not.toBe(body(view).id);
    expect(body(view).hidden).toBe(false);
    expect(body(view).textContent).toBe('the entries');
  });

  it('closes and opens with a click, and is drawn anew as the viewer left it', () => {
    toggle(draw()).click();
    const again = draw();
    expect(toggle(again).getAttribute('aria-expanded')).toBe('false');
    expect(body(again).hidden).toBe(true);
    expect(again.classList).toContain('d-view--collapsed');
    toggle(again).click();
    expect(body(draw()).hidden).toBe(false);
  });

  it('closes with ArrowLeft and opens with ArrowRight; other keys and Alt+arrows leave it', () => {
    const view = draw();
    const press = (key: string, init: KeyboardEventInit = {}) => toggle(view).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
    press('ArrowLeft');
    expect(body(view).hidden).toBe(true);
    press('ArrowLeft');
    expect(body(view).hidden).toBe(true);
    press('ArrowRight', { altKey: true });
    press('ArrowDown');
    expect(body(view).hidden).toBe(true);
    press('ArrowRight');
    expect(body(view).hidden).toBe(false);
  });

  it('starts closed when it says so, until the viewer opens it', () => {
    const view = draw({ collapsed: true });
    expect(body(view).hidden).toBe(true);
    toggle(view).click();
    expect(body(draw({ collapsed: true })).hidden).toBe(false);
  });

  it('keeps each view apart in the memento, by its id', () => {
    toggle(draw({ id: 'group.Shop' })).click();
    expect(body(draw({ id: 'group.Shop' })).hidden).toBe(true);
    expect(body(draw({ id: 'favorites' })).hidden).toBe(false);
    expect(JSON.parse(localStorage.getItem('dashica:global:test:views.group.Shop.collapsed')!)).toBe(true);
  });

  it('keeps nothing without a memento: drawn anew, it starts as it says', () => {
    const view = draw({ state: undefined, collapsed: false });
    toggle(view).click();
    expect(body(view).hidden).toBe(true);
    expect(body(draw({ state: undefined, collapsed: false })).hidden).toBe(false);
    expect(localStorage.length).toBe(0);
  });

  it('shows its description after the title and its actions at the header end', () => {
    const action = document.createElement('button');
    const view = draw({ actions: [action] });
    expect(view.querySelector('.d-view__toggle .d-view__description')!.textContent).toBe('2');
    expect(view.querySelector('.d-view__header > .d-view__actions')!.firstElementChild).toBe(action);
  });
});
