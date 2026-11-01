import type { Disposable } from '../../core/disposable/disposable';

/**
 * Commands: named actions an extension offers to the others. Other extensions, menu entries, key bindings and search
 * everywhere run them by id. The handler runs synchronously inside `executeCommand`, so focus and selection are still
 * those of the user's click or key. Whether a command can run now is the command's own (its `enablement`): every
 * place that shows or triggers it asks `enablement(id)`, so a menu entry, a rail button and search everywhere show it
 * greyed with its `disabledReason` on hover, and its keys do nothing.
 * A menu entry's `when` only says whether the entry shows.
 */
export interface Commands {
  /**
   * Registers `handler` as `id` (`<extension>.<name>`, e.g. `refresh.now`) until disposed, with what `options` says
   * of when it can run; throws if `id` is taken.
   */
  registerCommand(id: string, handler: (...args: any[]) => unknown, options?: CommandOptions): Disposable;
  /**
   * Resolves to the handler's result, whatever its `enablement` (code runs what it means to run); rejects for an
   * unknown `id` and when the handler throws or rejects.
   */
  executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T>;
  /** Whether `id` can run from a menu, a key, a button or search everywhere now; enabled for an unknown `id`. */
  enablement(id: string): CommandEnablement;
  /** The declared commands (`contributes.commands`) registered now, in declaration order: what search everywhere lists. */
  getCommands(): readonly CommandContribution[];
  /** The label of the first key bound to `id` (`⌘⇧F` on the Mac, else `Ctrl+Shift+F`); undefined: none. */
  keybindingLabel(id: string): string | undefined;
}

/** What `registerCommand` knows of when a command can run. */
export interface CommandOptions {
  /** Whether it can run now, asked each time it is shown or a key would run it; default: always. */
  readonly enablement?: () => boolean;
  /** Shown on hover while it cannot run: why ("Explore is not enabled (explore_enabled)"). */
  readonly disabledReason?: string;
}

/** What `enablement` answers: whether the command can run now and, while it cannot, why. */
export interface CommandEnablement {
  readonly enabled: boolean;
  /** While it cannot run: the command's `disabledReason`. */
  readonly disabledReason?: string;
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

/**
 * One entry of a menu (`ui.registerMenuItem`): a command by its id, shown while `when` holds, greyed while the command
 * is not enabled (`Commands.enablement`). `C`: what the menu is shown for (e.g. `{ url, title }` of a dashboard
 * entry), which `when` and `toggled` are asked with.
 */
export interface MenuItem<C extends object = MenuContext> {
  /** Run with the arguments the menu was shown with. */
  readonly command: string;
  /** Default: the command's title (`contributes.commands`), else its id. */
  readonly title?: string;
  /** SVG markup, drawn in `currentColor`; default: the command's. */
  readonly icon?: string;
  /** Whether the entry shows, asked each time the menu is shown; default: always. */
  readonly when?: (context: C) => boolean;
  /** For an entry that turns something on or off: whether it is on (a check mark), asked each time the menu is shown. */
  readonly toggled?: (context: C) => boolean;
  /** Entries are grouped by this: `navigation` first, the others by name, a separator between groups; default ''. */
  readonly group?: string;
  /** The place in its group (lower first; equal: registration order); default 0. */
  readonly order?: number;
}

/** What a menu is shown for, by key. */
export type MenuContext = Readonly<Record<string, unknown>>;

export type Platform = 'mac' | 'win' | 'linux';

export { CommandsHost } from './commands-impl';
export { keyLabel } from './commands-helpers';
