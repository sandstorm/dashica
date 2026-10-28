// See Commands in commands.ts.
import type { Platform } from './commands';

/** A key as people read it, for tooltips and menus: `Mod+Alt+KeyM` is `⌘⌥M` on the Mac, else `Ctrl+Alt+M`. */
export function keyLabel(key: string, mac = IS_MAC): string {
  const labels = mac ? MAC_LABELS : LABELS;
  // a modifier tapped twice (`Shift Shift`): each press by itself
  if (DOUBLE_TAP.test(key)) return key.split(' ').map((modifier) => labels[modifier]).join(' ');
  const parts = key.split('+');
  const name = parts.pop()!;
  const keyName = KEY_NAMES[name] ?? name.replace(/^(Key|Digit)(?=.)/, '');
  return [...parts.map((modifier) => labels[modifier] ?? modifier), keyName].join(mac ? '' : '+');
}

/** The platform the browser runs on. */
export const PLATFORM: Platform = typeof navigator === 'undefined' ? 'linux' : /Mac|iPhone|iPad/.test(navigator.platform) ? 'mac' : /Win/.test(navigator.platform) ? 'win' : 'linux';

const IS_MAC = PLATFORM === 'mac';

/** A modifier tapped twice (`Shift Shift`). */
export const DOUBLE_TAP = /^(Mod|Ctrl|Meta|Alt|Shift) \1$/;

/** The labels of the modifiers outside the Mac; its keys are the modifiers a binding may name. */
export const LABELS: Record<string, string> = { Mod: 'Ctrl', Ctrl: 'Ctrl', Meta: 'Meta', Alt: 'Alt', Shift: 'Shift' };

const MAC_LABELS: Record<string, string> = { Mod: '⌘', Ctrl: '⌃', Meta: '⌘', Alt: '⌥', Shift: '⇧' };

/** Codes labelled by a symbol; other codes lose a `Key` / `Digit` prefix (`KeyM` → `M`). */
const KEY_NAMES: Record<string, string> = { Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Semicolon: ';', Quote: "'", Backquote: '`' };
