// @vitest-environment jsdom
// Tests for extension-host.ts: activation, the declarations reaching the hosts, the mementos.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Disposable } from '../../core/disposable/disposable';
import { type Extension, type ExtensionContext, ExtensionHost, type ExtensionHostOptions, StorageMemento } from './extension-host';

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

/** Hosts that only take declarations, in a page whose storages keep the mementos. */
function hosts() {
  return {
    commands: { declareKeybindings: vi.fn(), declareCommands: vi.fn() },
    ownerDocument: document,
  };
}

const shared = hosts() as unknown as ExtensionHostOptions;

function extension(id: string, activate: (context: ExtensionContext) => void): Extension {
  return { id, activate };
}

describe('ExtensionHost', () => {
  it('activates in list order and disposes in reverse, each extension\'s subscriptions in reverse', () => {
    const order: string[] = [];
    const host = new ExtensionHost(shared);
    const logging = (id: string) =>
      extension(id, ({ subscriptions }) => {
        order.push(`activate ${id}`);
        subscriptions.push(new Disposable(() => order.push(`dispose ${id}.1`)), new Disposable(() => order.push(`dispose ${id}.2`)));
      });
    host.activate([logging('a'), logging('b')]);
    host.dispose();
    expect(order).toEqual(['activate a', 'activate b', 'dispose b.2', 'dispose b.1', 'dispose a.2', 'dispose a.1']);
  });

  it('also disposes what an extension registered after activation (e.g. once connected)', () => {
    let later: ExtensionContext['subscriptions'] = [];
    let disposed = false;
    const host = new ExtensionHost(shared);
    host.activate([extension('a', ({ subscriptions }) => (later = subscriptions))]);
    later.push(new Disposable(() => (disposed = true)));
    host.dispose();
    expect(disposed).toBe(true);
  });

  it('refuses an extension listed twice', () => {
    expect(() => new ExtensionHost(shared).activate([extension('a', () => {}), extension('a', () => {})])).toThrow(/twice/);
  });

  it('declares every extension\'s contributions before activating the first', () => {
    const fake = hosts();
    const declared = { commands: [{ command: 'b.run', title: 'Run' }], keybindings: [{ command: 'b.run', key: 'Mod+KeyR' }] };
    const seen: number[] = [];
    const host = new ExtensionHost(fake as unknown as ExtensionHostOptions);
    host.activate([extension('a', () => seen.push(fake.commands.declareCommands.mock.calls.length)), { id: 'b', contributes: declared, activate: () => {} }]);
    expect(seen).toEqual([2]);
    expect(fake.commands.declareKeybindings).toHaveBeenLastCalledWith(declared.keybindings);
    expect(fake.commands.declareCommands).toHaveBeenLastCalledWith(declared.commands);
  });

  it('gives each extension its own globalState (local storage) and workspaceState (session storage)', async () => {
    const states: Record<string, ExtensionContext> = {};
    new ExtensionHost(shared).activate(['a', 'b'].map((id) => extension(id, (context) => (states[id] = context))));
    await states.a.globalState.update('k', 1);
    await states.a.workspaceState.update('k', 2);
    expect(states.b.globalState.get('k')).toBeUndefined();
    expect(localStorage.getItem('dashica:global:a:k')).toBe('1');
    expect(sessionStorage.getItem('dashica:session:a:k')).toBe('2');
  });
});

describe('StorageMemento', () => {
  it('keeps values as JSON under its prefix, apart from other prefixes', async () => {
    const memento = StorageMemento.of(document, 'sessionStorage', 'dashica:session:dashboards:');
    expect(memento.get('openGroups')).toBeUndefined();
    expect(memento.get('openGroups', [])).toEqual([]);
    await memento.update('openGroups', ['shop']);
    expect(memento.get('openGroups')).toEqual(['shop']);
    expect(StorageMemento.of(document, 'sessionStorage', 'dashica:session:dashboards:').get('openGroups')).toEqual(['shop']);
    expect(StorageMemento.of(document, 'sessionStorage', 'dashica:session:other:').get('openGroups')).toBeUndefined();
    expect(sessionStorage.getItem('dashica:session:dashboards:openGroups')).toBe('["shop"]');
  });

  it('forgets a value updated to undefined', async () => {
    const memento = StorageMemento.of(document, 'localStorage', 'dashica:global:refresh:');
    await memento.update('on', false);
    expect(memento.get('on', true)).toBe(false);
    await memento.update('on', undefined);
    expect(memento.get('on', true)).toBe(true);
    expect(localStorage.getItem('dashica:global:refresh:on')).toBeNull();
  });

  it('gives defaults and keeps nothing without storage', async () => {
    const memento = new StorageMemento(() => {
      throw new Error('blocked');
    }, 'x:');
    await expect(memento.update('a', 1)).resolves.toBeUndefined();
    expect(memento.get('a', 2)).toBe(2);
    expect(new StorageMemento(() => null, 'x:').get('a')).toBeUndefined();
  });
});
