import type { CommandContribution, Commands, CommandsHost, KeybindingContribution } from '../commands/commands';

/**
 * A feature of the workbench (VS Code's extension). Built-in only: they live in `frontend/extensions/`; the instances
 * customize through Go.
 *
 * The extension host (`ExtensionHost`) runs it: activated once, in list order, after every extension's `contributes`
 * is known. What it pushes into `context.subscriptions` is disposed with the workbench.
 */
export interface Extension {
  /** Unique in the list (e.g. `timeRange`). */
  readonly id: string;
  /**
   * What the extension declares before any extension is activated (VS Code's `contributes` in an extension's
   * manifest): its commands and keys.
   */
  readonly contributes?: ExtensionContributions;
  /** Registers the extension's contributions; everything it pushes into `context.subscriptions` is disposed with the workbench. */
  activate(context: ExtensionContext): void;
}

/** What an extension declares up front (VS Code's `contributes`). */
export interface ExtensionContributions {
  /**
   * Its commands for people: what they are called (`commands.getCommands`, e.g. search everywhere's list, which
   * runs them without arguments: declare only commands that work without any).
   */
  readonly commands?: readonly CommandContribution[];
  /**
   * The keys of its commands (VS Code's `contributes.keybindings`): bound for the workbench's life, and shown wherever
   * the command is offered (search everywhere, menus).
   */
  readonly keybindings?: readonly KeybindingContribution[];
}

/**
 * What an extension gets to work with: VS Code's namespaces. Grows with the steps of the workbench concept
 * (`window`, `page`, `query`, `widgets`; docs/2026-10-28-workbench.md §3.11).
 */
export interface ExtensionContext {
  /** Disposed when the workbench is disposed, in reverse order (the extensions in reverse list order, too). */
  readonly subscriptions: { dispose(): unknown }[];
  /**
   * Values the extension keeps for this viewer across visits (VS Code's `globalState`: the browser's local storage),
   * apart from other extensions' (by `id`). E.g. favorites.
   */
  readonly globalState: Memento;
  /**
   * Values the extension keeps during the browser session (VS Code's `workspaceState`: the session storage), apart
   * from other extensions'. E.g. which panel is open.
   */
  readonly workspaceState: Memento;
  /** Commands by id and their key bindings (VS Code's `commands` namespace). */
  readonly commands: Commands;
}

/**
 * Values kept by key (VS Code's Memento), as JSON: what `get` gives is what was stored, so read it as data from
 * outside (check its shape). Without storage (blocked, private window) nothing is kept and nothing fails.
 */
export interface Memento {
  /** The value stored under `key`, else `defaultValue`. */
  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  /** Stores `value` (JSON-like) under `key`; `undefined` removes it. */
  update(key: string, value: unknown): Promise<void>;
}

/** The hosts an extension host gives its extensions, and which take their declarations (`contributes`). */
export interface ExtensionHostOptions {
  /** Takes the commands and keys extensions declare. */
  readonly commands: CommandsHost;
  /** The document whose window's storages keep the extensions' mementos. */
  readonly ownerDocument: Document;
}

export { ExtensionHost, StorageMemento } from './extension-host-impl';
