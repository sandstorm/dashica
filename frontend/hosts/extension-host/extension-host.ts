import type { CommandContribution, Commands, CommandsHost, KeybindingContribution } from '../commands/commands';
import type { WindowApi } from '../window/window';

/**
 * An extension: one feature of the workbench (the time range, the filters, a chart type). All are built in
 * (`frontend/extensions/`); the instances customize through Go. The `ExtensionHost` declares every extension's
 * `contributes` first, then activates each once, in list order; what an extension pushes into
 * `context.subscriptions` is disposed with the workbench, the last first.
 */
export interface Extension {
  /** Unique among the extensions (`timeRange`); also scopes its stored values. */
  readonly id: string;
  /** Declared before any extension is activated. */
  readonly contributes?: ExtensionContributions;
  /** Registers everything else, each registration pushed into `context.subscriptions`. */
  activate(context: ExtensionContext): void;
}

export interface ExtensionContributions {
  /** The commands people pick in search everywhere, which runs them without arguments: declare only those that need none. */
  readonly commands?: readonly CommandContribution[];
  /** Keys for its commands; menus and search everywhere show them next to the command. */
  readonly keybindings?: readonly KeybindingContribution[];
}

/** What `activate` gets. */
export interface ExtensionContext {
  /** Disposed with the workbench, the last first. */
  readonly subscriptions: { dispose(): unknown }[];
  /** Values kept for this viewer across visits (localStorage), apart from other extensions': favorites. */
  readonly globalState: Memento;
  /** Values kept for this browser session (sessionStorage), apart from other extensions': which panel is open. */
  readonly workspaceState: Memento;
  readonly commands: Commands;
  /** The workbench's regions: panels and bar items. */
  readonly window: WindowApi;
}

/**
 * Values stored as JSON by key. What `get` gives was stored by an earlier visit, so check its shape. Without storage
 * (blocked, private window) `get` gives the default and `update` keeps the value nowhere.
 */
export interface Memento {
  /** The value stored under `key`, else `defaultValue`. */
  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  /** Stores `value` (JSON-like) under `key`; `undefined` removes it. */
  update(key: string, value: unknown): Promise<void>;
}

export interface ExtensionHostOptions {
  /** Takes the declared commands and keys. */
  readonly commands: CommandsHost;
  readonly window: WindowApi;
  /** Whose localStorage and sessionStorage keep the stored values. */
  readonly ownerDocument: Document;
}

export { ExtensionHost, StorageMemento } from './extension-host-impl';
