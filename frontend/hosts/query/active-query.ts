// See QueryApi in query.ts.
import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter, type Event } from '../../core/event-emitter/event-emitter';
import type { QueryApi, QueryKey } from './query';

/** Where `activeQuery` finds the active tab's query state: the `page` host. */
export interface ActiveQuerySource {
  readonly activeQuery: QueryApi;
  /** Fires among others when another tab becomes active. */
  readonly onDidChangeTabs: Event<void>;
}

/**
 * The `QueryApi` extensions get (`ExtensionContext.query`): every read and call goes to the active tab's query state.
 * A key's `onDidChange` fires when the active tab's fires, and once when another tab becomes active;
 * `onDidRequestRefresh` only when the active tab's fires. So an extension shows the active tab's state with the code
 * it has for one page.
 */
export function activeQuery(source: ActiveQuerySource): QueryApi & { dispose(): void } {
  const refreshRequested = new EventEmitter<void>();
  /** The keys listened to through it: each one's change event, forwarded from the active tab's. */
  const forwarded = new Map<QueryKey<unknown>, { readonly changed: EventEmitter<void>; listening: Disposable }>();
  const active = () => source.activeQuery;
  const listen = (query: QueryApi) => query.onDidRequestRefresh(() => refreshRequested.fire());
  const listenTo = (key: QueryKey<unknown>, changed: EventEmitter<void>) => active().onDidChange(key, () => changed.fire());
  let shown = active();
  let listening = listen(shown);
  const onTabs = source.onDidChangeTabs(() => {
    if (active() === shown) return;
    listening.dispose();
    shown = active();
    listening = listen(shown);
    for (const [key, forwarding] of forwarded) {
      forwarding.listening.dispose();
      forwarding.listening = listenTo(key, forwarding.changed);
    }
    for (const { changed } of [...forwarded.values()]) changed.fire();
  });
  const dispose = new Disposable(() => {
    onTabs.dispose();
    listening.dispose();
    refreshRequested.dispose();
    for (const { changed, listening: forwarding } of forwarded.values()) {
      forwarding.dispose();
      changed.dispose();
    }
  });
  return {
    // the tabs share their keys: declared in the active tab, a key is declared in each
    declare: (key) => active().declare(key),
    get: (key) => active().get(key),
    set: (key, value) => active().set(key, value),
    onDidChange(key, listener) {
      let forwarding = forwarded.get(key);
      if (!forwarding) {
        const changed = new EventEmitter<void>();
        forwarding = { changed, listening: listenTo(key, changed) };
        forwarded.set(key, forwarding);
      }
      return forwarding.changed.event(listener);
    },
    onDidRequestRefresh: refreshRequested.event,
    refresh: () => active().refresh(),
    requestParams: () => active().requestParams(),
    dispose: () => dispose.dispose(),
  };
}
