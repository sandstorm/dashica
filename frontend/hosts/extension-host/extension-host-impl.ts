// See Extension in extension-host.ts.
import { Disposable } from '../../core/disposable/disposable';
import type { Extension, ExtensionContext, ExtensionContributions, ExtensionHostOptions, Memento } from './extension-host';

/** Runs the workbench's extensions: `activate` once, `dispose` with the workbench (the last extension first). */
export class ExtensionHost {
  readonly #activated: { dispose(): unknown }[][] = [];

  constructor(private readonly options: ExtensionHostOptions) {}

  /** Throws for an id listed twice. */
  activate(extensions: readonly Extension[]): void {
    const ids = new Set<string>();
    for (const extension of extensions) {
      if (ids.has(extension.id)) throw new Error(`Extension ${extension.id} is in the list twice`);
      ids.add(extension.id);
      this.#declare(extension.contributes ?? {});
    }
    for (const extension of extensions) {
      const subscriptions: { dispose(): unknown }[] = [];
      this.#activated.push(subscriptions);
      extension.activate(this.#context(extension.id, subscriptions));
    }
  }

  dispose(): void {
    for (const subscriptions of this.#activated.splice(0).reverse()) Disposable.from(...subscriptions).dispose();
  }

  #declare({ keybindings, commands }: ExtensionContributions): void {
    this.options.commands.declareKeybindings(keybindings);
    this.options.commands.declareCommands(commands);
  }

  #context(id: string, subscriptions: ExtensionContext['subscriptions']): ExtensionContext {
    const { commands, ui, query, widgets, ownerDocument } = this.options;
    return {
      commands,
      ui,
      query,
      widgets,
      subscriptions,
      globalState: StorageMemento.of(ownerDocument, 'localStorage', `dashica:global:${id}:`),
      workspaceState: StorageMemento.of(ownerDocument, 'sessionStorage', `dashica:session:${id}:`),
    };
  }
}

/** A `Memento` in a browser storage, its keys under `prefix`. `storage`: null when there is none (blocked, no window). */
export class StorageMemento implements Memento {
  constructor(
    private readonly storage: () => Storage | null,
    private readonly prefix: string,
  ) {}

  static of(doc: Document, kind: 'localStorage' | 'sessionStorage', prefix: string): StorageMemento {
    return new StorageMemento(() => {
      try {
        return doc.defaultView?.[kind] ?? null;
      } catch {
        return null;
      }
    }, prefix);
  }

  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  get<T>(key: string, defaultValue?: T): T | undefined {
    try {
      const text = this.storage()?.getItem(this.prefix + key);
      return text == null ? defaultValue : (JSON.parse(text) as T);
    } catch {
      return defaultValue;
    }
  }

  update(key: string, value: unknown): Promise<void> {
    try {
      const storage = this.storage();
      if (value === undefined) storage?.removeItem(this.prefix + key);
      else storage?.setItem(this.prefix + key, JSON.stringify(value));
    } catch {
      // storage full or blocked: the value lasts as long as whoever holds it
    }
    return Promise.resolve();
  }
}
