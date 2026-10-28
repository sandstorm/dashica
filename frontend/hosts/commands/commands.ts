import type { Disposable } from '../../core/disposable/disposable';

/**
 * Commands and key bindings.
 *
 * A command is how one extension offers an action to the others: it registers a handler
 * under an id, and anyone who knows the id runs it, so it's called from:
 * - other extensions
 * - menu entries
 * - key bindings
 *
 * Called synchronously, so f.e. selection and focus are guaranteed to not change between dispatching the command and the command's body.
 */
export interface Commands {
  /**
   * Registers `handler` as command `id` (`<extension>.<name>`, e.g. `timeRange.refresh`) until disposed; an id
   * registered twice is an error. Other extensions and the host run it by id (`executeCommand`), never by importing it.
   */
  registerCommand(id: string, handler: (...args: any[]) => unknown): Disposable;
  /**
   * Runs command `id` with `args` and resolves to its result (awaited if it is a Promise). The handler is called
   * synchronously, so the user's gesture, the selection and the focus are as now. Rejects for an unknown id and when
   * the handler throws or rejects.
   */
  executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T>;
  /**
   * The commands declared for people (`contributes.commands`) that are registered now, in declaration order: what
   * search everywhere lists under "Commands". Each runs without arguments.
   */
  getCommands(): readonly CommandContribution[];
  /** The key that runs command `id`, as people read it (`⌘⇧F`, `Ctrl+Shift+F`): the first bound; undefined: none. */
  keybindingLabel(id: string): string | undefined;
}

/** A command as people see it. */
export interface CommandContribution {
  /** The command's id (`registerCommand`). */
  readonly command: string;
  /** What it does, as a menu would say it ("Refresh", "Last 1 hour"). */
  readonly title: string;
  /** What it belongs to, shown before the title ("Time range: Last 1 hour"). */
  readonly category?: string;
  /** An SVG icon (markup drawn in `currentColor`), for the menu entries that run it. */
  readonly icon?: string;
}

/**
 * A key that runs a command anywhere in the workbench, before the content sees
 * the key (it never does; a failing command is logged). A platform's own key replaces `key` there; '' is no key there.
 */
export interface KeybindingContribution {
  /** The command's id. */
  readonly command: string;
  /**
   * The key: modifiers and a `KeyboardEvent.code`, joined by `+`, e.g. `Mod+Alt+KeyM` (Mod: Cmd on the Mac, else
   * Ctrl). The modifiers must be exactly those: `Alt+Digit1` is not AltGr+1 (Ctrl+Alt on Windows),
   * `Ctrl+Minus` not Ctrl+Shift+Minus. A modifier tapped twice is a key, too: `Shift
   * Shift`, `Alt Alt`, …, not while the user types in a text field.
   */
  readonly key: string;
  /** The key on the Mac instead. */
  readonly mac?: string;
  /** The key on Windows instead. */
  readonly win?: string;
  /** The key on Linux (and any other system) instead. */
  readonly linux?: string;
  /** The command's one argument (none if not given). */
  readonly args?: unknown;
}

/** The systems whose keys differ. */
export type Platform = 'mac' | 'win' | 'linux';

export { CommandsHost } from './commands-impl';
export { keyLabel } from './commands-helpers';
