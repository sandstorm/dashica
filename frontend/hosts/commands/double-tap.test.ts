// @vitest-environment jsdom
// Tests for double-tap.ts: what counts as pressing a modifier twice.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listenForDoubleTap } from './double-tap';

afterEach(() => document.body.replaceChildren());

function setup() {
  const hostContainer = document.body.appendChild(document.createElement('div'));
  // content inside that keeps its keys to itself (as a chart's or table's own key handling may)
  const contentContainer = hostContainer.appendChild(document.createElement('div'));
  contentContainer.addEventListener('keydown', (event) => event.stopPropagation());
  contentContainer.addEventListener('keyup', (event) => event.stopPropagation());
  let time = 0;
  const onDoubleShift = vi.fn();
  listenForDoubleTap(hostContainer, 'Shift', onDoubleShift, () => time);
  const send = (type: 'keydown' | 'keyup', key: string, init: KeyboardEventInit = {}) =>
    contentContainer.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, ...init }));
  /** Shift down and up, `wait` ms after the previous step. */
  const tap = (wait = 0, init: KeyboardEventInit = {}) => {
    time += wait;
    send('keydown', 'Shift', { shiftKey: true, ...init });
    time += 50;
    send('keyup', 'Shift', init);
  };
  return { onDoubleShift, send, tap, wait: (ms: number) => (time += ms) };
}

describe('listenForDoubleTap', () => {
  it('fires when Shift is tapped twice quickly, inside the content too, on the second release', () => {
    const { onDoubleShift, tap, send } = setup();
    tap();
    send('keydown', 'Shift', { shiftKey: true });
    expect(onDoubleShift).not.toHaveBeenCalled();
    send('keyup', 'Shift');
    expect(onDoubleShift).toHaveBeenCalledTimes(1);
  });

  it('needs the second press within 300 ms of the first release', () => {
    const { onDoubleShift, tap } = setup();
    tap();
    tap(300);
    expect(onDoubleShift).toHaveBeenCalledTimes(1);
    tap(400);
    tap(301);
    expect(onDoubleShift).toHaveBeenCalledTimes(1);
  });

  it('does not count Shift held for a capital letter, nor a key pressed in between', () => {
    const { onDoubleShift, tap, send } = setup();
    tap();
    send('keydown', 'Shift', { shiftKey: true });
    send('keydown', 'A', { shiftKey: true });
    send('keyup', 'Shift');
    expect(onDoubleShift).not.toHaveBeenCalled();
    tap();
    send('keydown', 'a');
    tap();
    expect(onDoubleShift).not.toHaveBeenCalled();
  });

  it('does not count Shift with another modifier, a mouse press in between, or a held key repeating', () => {
    const { onDoubleShift, tap, send } = setup();
    tap(0, { ctrlKey: true });
    tap();
    expect(onDoubleShift).not.toHaveBeenCalled();
    tap(1000);
    document.body.firstElementChild!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    tap();
    expect(onDoubleShift).not.toHaveBeenCalled();
    tap(1000);
    send('keydown', 'Shift', { shiftKey: true });
    send('keydown', 'Shift', { shiftKey: true, repeat: true });
    send('keyup', 'Shift');
    expect(onDoubleShift).toHaveBeenCalledTimes(1);
  });

  it('does not count presses in a text field (an input box), and counts another modifier alone', () => {
    const hostContainer = document.body.appendChild(document.createElement('div'));
    const fieldElement = hostContainer.appendChild(document.createElement('input'));
    const onAlt = vi.fn();
    listenForDoubleTap(hostContainer, 'Alt', onAlt);
    const tapOn = (targetElement: Element, key: string, init: KeyboardEventInit) => {
      for (const type of ['keydown', 'keyup']) targetElement.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, ...(type === 'keydown' ? init : {}) }));
    };
    tapOn(fieldElement, 'Alt', { altKey: true });
    tapOn(fieldElement, 'Alt', { altKey: true });
    expect(onAlt).not.toHaveBeenCalled();
    tapOn(hostContainer, 'Alt', { altKey: true });
    tapOn(hostContainer, 'Alt', { altKey: true });
    expect(onAlt).toHaveBeenCalledTimes(1);
  });
});
