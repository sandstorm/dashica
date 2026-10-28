import type { Disposable } from '../../core/disposable/disposable';

/**
 * Commands: named actions an extension offers to the others. Other extensions, menu entries, key bindings and search
 * everywhere run them by id. The handler runs synchronously inside `executeCommand`, so focus and selection are still
 * those of the user's click or key.
 */
export interface Commands {
  /** Registers `handler` as `id` (`<extension>.<name>`, e.g. `timeRange.refresh`) until disposed; throws if `id` is taken. */
  registerCommand(id: string, handler: (...args: any[]) => unknown): Disposable;
  /** Resolves to the handler's result; rejects for an unknown `id` and when the handler throws or rejects. */
  executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T>;
  /** The declared commands (`contributes.commands`) registered now, in declaration order: what search everywhere lists. */
  getCommands(): readonly CommandContribution[];
  /** The label of the first key bound to `id` (`⌘⇧F` on the Mac, else `Ctrl+Shift+F`); undefined: none. */
  keybindingLabel(id: string): string | undefined;
}

/** A command as an extension declares it in `contributes.commands`, for menus and search everywhere. */
export interface CommandContribution {
  readonly command: string;
  /** What menus say ("Refresh"). */
  readonly title: string;
  /** Shown before the title in search everywhere ("Time range: Refresh"). */
  readonly category?: string;
  /** SVG markup, drawn in `currentColor`. */
  readonly icon?: string;
}

/** A key that runs a command anywhere in the workbench, as an extension declares it in `contributes.keybindings`. */
export interface KeybindingContribution {
  readonly command: string;
  /**
   * Modifiers and a `KeyboardEvent.code`, joined by `+` (`Mod+KeyK`; `Mod` is Cmd on the Mac, else Ctrl), or a
   * modifier tapped twice (`Shift Shift`, outside text fields). The modifiers match exactly: `Ctrl+Minus` fires on
   * Ctrl and Minus alone.
   */
  readonly key: string;
  /** `key` on the Mac; '' unbinds it there. */
  readonly mac?: string;
  /** `key` on Windows; '' unbinds it there. */
  readonly win?: string;
  /** `key` on Linux and other systems; '' unbinds it there. */
  readonly linux?: string;
  /** The one argument the command gets. */
  readonly args?: unknown;
}

export type Platform = 'mac' | 'win' | 'linux';

export { CommandsHost } from './commands-impl';
export { keyLabel } from './commands-helpers';
