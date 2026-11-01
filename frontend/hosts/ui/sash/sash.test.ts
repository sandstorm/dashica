// @vitest-environment jsdom
// Tests for sash.ts.
import { afterEach, describe, expect, it } from 'vitest';
import { Sash, type SashOptions } from './sash';

let sash: Sash | undefined;

afterEach(() => {
  sash?.dispose();
  sash = undefined;
});

function setup(options: Partial<SashOptions> = {}): { sash: Sash; changes: number[] } {
  sash = new Sash({ orientation: 'horizontal', label: 'SQL editor height', size: 200, min: 100, max: 400, step: 20, ownerDocument: document, ...options });
  document.body.append(sash.sashElement);
  const changes: number[] = [];
  sash.onDidChange((size) => changes.push(size));
  return { sash, changes };
}

function key(target: Element, key: string): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

function pointer(target: EventTarget, type: string, at: { clientX?: number; clientY?: number }): void {
  // jsdom has no PointerEvent: a MouseEvent of the same type carries the coordinates
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, ...at }));
}

describe('Sash', () => {
  it('is a separator with its label, bounds and size, the starting size brought within them', () => {
    const { sash } = setup({ size: 1000 });
    expect(sash.sashElement.getAttribute('role')).toBe('separator');
    expect(sash.sashElement.getAttribute('aria-orientation')).toBe('horizontal');
    expect(sash.sashElement.getAttribute('aria-label')).toBe('SQL editor height');
    expect(sash.sashElement.getAttribute('aria-valuemin')).toBe('100');
    expect(sash.sashElement.getAttribute('aria-valuemax')).toBe('400');
    expect(sash.size).toBe(400);
    expect(sash.sashElement.getAttribute('aria-valuenow')).toBe('400');
    expect(sash.sashElement.tabIndex).toBe(0);
  });

  it('a horizontal sash moves by step with ArrowUp and ArrowDown, within its bounds, and says each change', () => {
    const { sash, changes } = setup();
    key(sash.sashElement, 'ArrowDown');
    key(sash.sashElement, 'ArrowLeft');
    expect(sash.size).toBe(220);
    for (let i = 0; i < 10; i++) key(sash.sashElement, 'ArrowUp');
    expect(sash.size).toBe(100);
    expect(sash.sashElement.getAttribute('aria-valuenow')).toBe('100');
    expect(changes).toEqual([220, 200, 180, 160, 140, 120, 100]);
  });

  it('a vertical sash moves with ArrowLeft and ArrowRight; reversed, left makes it larger', () => {
    const { sash } = setup({ orientation: 'vertical', reverse: true });
    key(sash.sashElement, 'ArrowDown');
    key(sash.sashElement, 'ArrowLeft');
    expect(sash.size).toBe(220);
    key(sash.sashElement, 'ArrowRight');
    key(sash.sashElement, 'ArrowRight');
    expect(sash.size).toBe(180);
  });

  it('follows a drag until the pointer is released, within its bounds, the page marked meanwhile', () => {
    const { sash, changes } = setup();
    pointer(sash.sashElement, 'pointerdown', { clientY: 500 });
    expect(document.documentElement.classList.contains('d-sash-dragging--horizontal')).toBe(true);
    expect(sash.sashElement.classList.contains('d-sash--active')).toBe(true);
    pointer(document, 'pointermove', { clientY: 550 });
    expect(sash.size).toBe(250);
    pointer(document, 'pointermove', { clientY: 900 });
    expect(sash.size).toBe(400);
    pointer(document, 'pointermove', { clientY: 0 });
    expect(sash.size).toBe(100);
    pointer(document, 'pointerup', { clientY: 0 });
    expect(document.documentElement.classList.contains('d-sash-dragging--horizontal')).toBe(false);
    expect(sash.sashElement.classList.contains('d-sash--active')).toBe(false);
    pointer(document, 'pointermove', { clientY: 600 });
    expect(sash.size).toBe(100);
    expect(changes).toEqual([250, 400, 100]);
  });

  it('a drag of a vertical sash goes by x, reversed and scaled by perPixel', () => {
    const { sash } = setup({ orientation: 'vertical', reverse: true, perPixel: () => 0.5 });
    pointer(sash.sashElement, 'pointerdown', { clientX: 300, clientY: 0 });
    pointer(document, 'pointermove', { clientX: 260, clientY: 999 });
    expect(sash.size).toBe(220);
    pointer(document, 'pointerup', {});
  });

  it('starts a move from the size shown, when that is less than the size kept', () => {
    const { sash } = setup({ size: 380, shownSize: () => 250 });
    key(sash.sashElement, 'ArrowUp');
    expect(sash.size).toBe(230);
    pointer(sash.sashElement, 'pointerdown', { clientY: 100 });
    pointer(document, 'pointermove', { clientY: 110 });
    expect(sash.size).toBe(260);
    pointer(document, 'pointerup', {});
  });

  it('disposed, it is gone and a drag in progress stops', () => {
    const { sash, changes } = setup();
    pointer(sash.sashElement, 'pointerdown', { clientY: 0 });
    sash.dispose();
    pointer(document, 'pointermove', { clientY: 50 });
    expect(changes).toEqual([]);
    expect(sash.sashElement.isConnected).toBe(false);
    expect(document.documentElement.classList.contains('d-sash-dragging--horizontal')).toBe(false);
  });
});
