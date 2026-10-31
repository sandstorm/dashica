// See Commands in commands.ts.
import { Disposable } from '../../core/disposable/disposable';
import type { CommandContribution, CommandEnablement, CommandOptions, Commands, KeybindingContribution, Platform } from './commands';
import { DOUBLE_TAP, keyLabel, LABELS, PLATFORM } from './commands-helpers';
import { listenForDoubleTap } from './double-tap';

/** The workbench's `Commands`; listens for the bound keys on `root`. `platform`: whose keys apply, default the browser's. */
export class CommandsHost implements Commands {
  readonly #handlers = new Map<string, CommandHandler>();
  readonly #options = new Map<string, CommandOptions>();
  readonly #keybindings: { key: string; matches(event: KeyboardEvent): boolean; command: string; args: unknown[] }[] = [];
  readonly #taps: Disposable[] = [];
  #declared: readonly CommandContribution[] = [];
  readonly #platform: Platform;
  readonly #mac: boolean;

  constructor(
    private readonly root: HTMLElement,
    options: { platform?: Platform } = {},
  ) {
    this.#platform = options.platform ?? PLATFORM;
    this.#mac = this.#platform === 'mac';
    root.addEventListener('keydown', this.#handleKey, true);
  }

  registerCommand(id: string, handler: CommandHandler, options: CommandOptions = {}): Disposable {
    if (this.#handlers.has(id)) throw new Error(`Command ${id} is registered already`);
    this.#handlers.set(id, handler);
    this.#options.set(id, options);
    return new Disposable(() => {
      this.#handlers.delete(id);
      this.#options.delete(id);
    });
  }

  enablement(id: string): CommandEnablement {
    const { enablement, disabledReason } = this.#options.get(id) ?? {};
    if (!enablement || enablement()) return ENABLED;
    return disabledReason === undefined ? { enabled: false } : { enabled: false, disabledReason };
  }

  executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T> {
    const handler = this.#handlers.get(id);
    if (!handler) return Promise.reject(new Error(`No command ${id}`));
    try {
      return Promise.resolve(handler(...args) as T);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Adds the commands extensions declare (`contributes.commands`), for `getCommands`. */
  declareCommands(commands: readonly CommandContribution[] = []): void {
    this.#declared = [...this.#declared, ...commands];
  }

  getCommands(): readonly CommandContribution[] {
    return this.#declared.filter(({ command }) => this.#handlers.has(command));
  }

  /** Binds the keys extensions declare (`contributes.keybindings`), each the platform's own if it has one. */
  declareKeybindings(keybindings: readonly KeybindingContribution[] = []): void {
    for (const keybinding of keybindings) {
      const key = keybinding[this.#platform] ?? keybinding.key;
      if (key) this.#bind(key, keybinding.command, keybinding.args);
    }
  }

  keybindingLabel(id: string): string | undefined {
    for (const binding of this.#keybindings) if (binding.command === id) return keyLabel(binding.key, this.#mac);
    return undefined;
  }

  dispose(): void {
    this.root.removeEventListener('keydown', this.#handleKey, true);
    this.#handlers.clear();
    this.#options.clear();
    this.#keybindings.length = 0;
    for (const taps of this.#taps.splice(0)) taps.dispose();
  }

  #bind(key: string, command: string, args: unknown): void {
    const tapped = DOUBLE_TAP.exec(key)?.[1];
    const binding = { key, matches: tapped ? () => false : parseKey(key, this.#mac), command, args: args === undefined ? [] : [args] };
    this.#keybindings.push(binding);
    if (tapped) this.#taps.push(listenForDoubleTap(this.root, modifierKey(tapped, this.#mac), () => this.#run(binding)));
  }

  readonly #handleKey = (event: KeyboardEvent): void => {
    for (const binding of this.#keybindings) {
      // a command that cannot run now leaves the key to the next binding or the content
      if (!binding.matches(event) || !this.#handlers.has(binding.command) || !this.enablement(binding.command).enabled) continue;
      // prevented now, while the event is dispatched; the command may finish later
      event.preventDefault();
      event.stopPropagation();
      this.#run(binding);
      return;
    }
  };

  /** Runs a key's command while it can run; logs a failure: for a key press, the console is where it is reported. */
  #run({ command, args }: { command: string; args: unknown[] }): void {
    if (this.#handlers.has(command) && this.enablement(command).enabled) this.executeCommand(command, ...args).catch((error: unknown) => console.error(`Command ${command} failed:`, error));
  }
}

/** The `KeyboardEvent.key` of a modifier named in a binding. */
function modifierKey(modifier: string, mac: boolean): string {
  if (modifier === 'Mod') return mac ? 'Meta' : 'Control';
  return modifier === 'Ctrl' ? 'Control' : modifier;
}

type CommandHandler = (...args: any[]) => unknown;

const ENABLED: CommandEnablement = { enabled: true };

/** `Mod+Alt+KeyM` → a test for the event: that `code`, and exactly the named modifiers pressed. */
function parseKey(key: string, mac: boolean): (event: KeyboardEvent) => boolean {
  const parts = key.split('+');
  const code = parts.pop()!;
  const wanted = new Set(
    parts.map((name) => {
      if (!(name in LABELS)) throw new Error(`Unknown modifier ${name} in key ${key}`);
      return name === 'Mod' ? (mac ? 'Meta' : 'Ctrl') : name;
    }),
  );
  return (event) =>
    event.code === code && event.ctrlKey === wanted.has('Ctrl') && event.metaKey === wanted.has('Meta') && event.altKey === wanted.has('Alt') && event.shiftKey === wanted.has('Shift');
}
