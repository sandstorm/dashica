// See KeybindingContribution in commands.ts.
import { Disposable } from '../../core/disposable/disposable';

/**
 * Calls `onDoubleTap` when `modifier` (a `KeyboardEvent.key`: `Shift`, `Control`, `Alt`, `Meta`) is pressed twice on
 * `targetElement`, alone and within `DOUBLE_TAP_INTERVAL`; it fires on the second release, outside text fields.
 * `now`: the clock in milliseconds.
 */
export function listenForDoubleTap(targetElement: HTMLElement, modifier: string, onDoubleTap: () => void, now: () => number = Date.now): Disposable {
  /** `down`: pressed alone; `up`: released after such a press (at `releasedAt`); `again`: pressed a second time. */
  let state: 'idle' | 'down' | 'up' | 'again' = 'idle';
  let releasedAt = 0;
  const keydown = (event: KeyboardEvent) => {
    if (!isAlone(event, modifier) || inTextField(event)) state = 'idle';
    else if (event.repeat) return;
    else state = state === 'up' && now() - releasedAt <= DOUBLE_TAP_INTERVAL ? 'again' : 'down';
  };
  const keyup = (event: KeyboardEvent) => {
    if (event.key !== modifier) return;
    if (state === 'again') onDoubleTap();
    state = state === 'down' ? 'up' : 'idle';
    releasedAt = now();
  };
  const reset = () => (state = 'idle');
  targetElement.addEventListener('keydown', keydown, true);
  targetElement.addEventListener('keyup', keyup, true);
  targetElement.addEventListener('pointerdown', reset, true);
  return new Disposable(() => {
    targetElement.removeEventListener('keydown', keydown, true);
    targetElement.removeEventListener('keyup', keyup, true);
    targetElement.removeEventListener('pointerdown', reset, true);
  });
}

/** Milliseconds from releasing the modifier to pressing it again. */
export const DOUBLE_TAP_INTERVAL = 300;

/** Pressed alone, outside an IME composition. */
function isAlone(event: KeyboardEvent, modifier: string): boolean {
  const others = { Shift: event.shiftKey, Control: event.ctrlKey, Alt: event.altKey, Meta: event.metaKey };
  return event.key === modifier && !event.isComposing && Object.entries(others).every(([name, pressed]) => name === modifier || !pressed);
}

function inTextField(event: KeyboardEvent): boolean {
  const target = event.composedPath()[0];
  return target instanceof Element && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
}
