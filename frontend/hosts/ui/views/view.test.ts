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
const toggle = (viewElement: HTMLElement) => viewElement.querySelector<HTMLButtonElement>('.d-view__toggle')!;
const body = (viewElement: HTMLElement) => viewElement.querySelector<HTMLElement>('.d-view__body')!;

describe('createView', () => {
  it('shows its title as a heading button that controls its open body', () => {
    const viewElement = draw();
    expect(viewElement.querySelector('h2 > button.d-view__toggle .d-view__title')!.textContent).toBe('Favorites');
    expect(toggle(viewElement).getAttribute('aria-expanded')).toBe('true');
    expect(toggle(viewElement).getAttribute('aria-controls')).toBe(body(viewElement).id);
    expect(body(viewElement).id).toMatch(/^d-view-\d+$/);
    expect(body(draw()).id).not.toBe(body(viewElement).id);
    expect(body(viewElement).hidden).toBe(false);
    expect(body(viewElement).textContent).toBe('the entries');
  });

  it('closes and opens with a click, and is drawn anew as the viewer left it', () => {
    toggle(draw()).click();
    const secondViewElement = draw();
    expect(toggle(secondViewElement).getAttribute('aria-expanded')).toBe('false');
    expect(body(secondViewElement).hidden).toBe(true);
    expect(secondViewElement.classList).toContain('d-view--collapsed');
    toggle(secondViewElement).click();
    expect(body(draw()).hidden).toBe(false);
  });

  it('closes with ArrowLeft and opens with ArrowRight; other keys and Alt+arrows leave it', () => {
    const viewElement = draw();
    const press = (key: string, init: KeyboardEventInit = {}) => toggle(viewElement).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
    press('ArrowLeft');
    expect(body(viewElement).hidden).toBe(true);
    press('ArrowLeft');
    expect(body(viewElement).hidden).toBe(true);
    press('ArrowRight', { altKey: true });
    press('ArrowDown');
    expect(body(viewElement).hidden).toBe(true);
    press('ArrowRight');
    expect(body(viewElement).hidden).toBe(false);
  });

  it('starts closed when it says so, until the viewer opens it', () => {
    const viewElement = draw({ collapsed: true });
    expect(body(viewElement).hidden).toBe(true);
    toggle(viewElement).click();
    expect(body(draw({ collapsed: true })).hidden).toBe(false);
  });

  it('keeps each view apart in the memento, by its id', () => {
    toggle(draw({ id: 'group.Shop' })).click();
    expect(body(draw({ id: 'group.Shop' })).hidden).toBe(true);
    expect(body(draw({ id: 'favorites' })).hidden).toBe(false);
    expect(JSON.parse(localStorage.getItem('dashica:global:test:views.group.Shop.collapsed')!)).toBe(true);
  });

  it('keeps nothing without a memento: drawn anew, it starts as it says', () => {
    const viewElement = draw({ state: undefined, collapsed: false });
    toggle(viewElement).click();
    expect(body(viewElement).hidden).toBe(true);
    expect(body(draw({ state: undefined, collapsed: false })).hidden).toBe(false);
    expect(localStorage.length).toBe(0);
  });

  it('shows its description after the title and its actions at the header end', () => {
    const actionElement = document.createElement('button');
    const viewElement = draw({ actionElements: [actionElement] });
    expect(viewElement.querySelector('.d-view__toggle .d-view__description')!.textContent).toBe('2');
    expect(viewElement.querySelector('.d-view__header > .d-view__actions')!.firstElementChild).toBe(actionElement);
  });
});
