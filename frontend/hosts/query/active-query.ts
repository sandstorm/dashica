// See QueryApi in query.ts.
import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter, type Event } from '../../core/event-emitter/event-emitter';
import type { FilterChip, FiltersModel, ParamsModel, Pill, QueryApi, QueryState, QueryStateSpec, TimeModel } from './query';

/** Where `activeQuery` finds the active tab's query state: the `page` host. */
export interface ActiveQuerySource {
  readonly activeQuery: QueryApi;
  /** Fires among others when another tab becomes active. */
  readonly onDidChangeTabs: Event<void>;
}

/**
 * The `QueryApi` extensions get (`ExtensionContext.query`): every read and call goes to the active tab's query state.
 * Each model's and registered state's `onDidChange` fires when the active tab's fires, and once when another tab becomes active;
 * `onDidRequestRefresh` only when the active tab's fires. So the time picker, the refresh button and the filter bar
 * show the active tab's state with the code they have for one page.
 */
export function activeQuery(source: ActiveQuerySource): QueryApi & { dispose(): void } {
  const timeChanged = new EventEmitter<void>();
  const filtersChanged = new EventEmitter<void>();
  const paramsChanged = new EventEmitter<void>();
  const refreshRequested = new EventEmitter<void>();
  /** The registered states read through it, by id: each one's value, the active tab's, and its change event. */
  const states = new Map<string, { readonly state: QueryState<unknown>; readonly changed: EventEmitter<void>; listening: Disposable }>();
  const active = () => source.activeQuery;
  const listen = (query: QueryApi) =>
    Disposable.from(
      query.time.onDidChange(() => timeChanged.fire()),
      query.filters.onDidChange(() => filtersChanged.fire()),
      query.params.onDidChange(() => paramsChanged.fire()),
      query.onDidRequestRefresh(() => refreshRequested.fire()),
    );
  const listenTo = (id: string, changed: EventEmitter<void>) => active().state(id)?.onDidChange(() => changed.fire()) ?? Disposable.from();
  let shown = active();
  let listening = listen(shown);
  const onTabs = source.onDidChangeTabs(() => {
    if (active() === shown) return;
    listening.dispose();
    shown = active();
    listening = listen(shown);
    for (const [id, forwarded] of states) {
      forwarded.listening.dispose();
      forwarded.listening = listenTo(id, forwarded.changed);
    }
    timeChanged.fire();
    filtersChanged.fire();
    paramsChanged.fire();
    for (const { changed } of states.values()) changed.fire();
  });
  /** The value of the state `id` in the active tab, while it is registered. */
  const state = <T>(id: string): QueryState<T> | undefined => {
    if (!active().state(id)) return undefined;
    let forwarded = states.get(id);
    if (!forwarded) {
      const changed = new EventEmitter<void>();
      forwarded = {
        state: { get: () => active().state(id)?.get(), set: (value) => active().state(id)?.set(value), onDidChange: changed.event },
        changed,
        listening: listenTo(id, changed),
      };
      states.set(id, forwarded);
    }
    return forwarded.state as QueryState<T>;
  };

  const time: TimeModel = {
    get range() {
      return active().time.range;
    },
    get custom() {
      return active().time.custom;
    },
    get autoRefresh() {
      return active().time.autoRefresh;
    },
    setRange: (range) => active().time.setRange(range),
    setCustom: (from, to) => active().time.setCustom(from, to),
    setAutoRefresh: (seconds) => active().time.setAutoRefresh(seconds),
    onDidChange: timeChanged.event,
  };
  const filters: FiltersModel = {
    get chips(): readonly FilterChip[] {
      return active().filters.chips;
    },
    add: ((conditionOrPill: string | Pill) =>
      typeof conditionOrPill === 'string' ? active().filters.add(conditionOrPill) : active().filters.add(conditionOrPill)) as FiltersModel['add'],
    replace: (index, chip) => active().filters.replace(index, chip),
    remove: (which) => active().filters.remove(which),
    clear: () => active().filters.clear(),
    onDidChange: filtersChanged.event,
  };
  const params: ParamsModel = {
    get values() {
      return active().params.values;
    },
    get: (name) => active().params.get(name),
    set: (name, value) => active().params.set(name, value),
    onDidChange: paramsChanged.event,
  };
  const dispose = new Disposable(() => {
    onTabs.dispose();
    listening.dispose();
    for (const emitter of [timeChanged, filtersChanged, paramsChanged, refreshRequested]) emitter.dispose();
    for (const { changed, listening: forwarding } of states.values()) {
      forwarding.dispose();
      changed.dispose();
    }
  });
  return {
    time,
    filters,
    params,
    registerState: <T>(id: string, spec: QueryStateSpec<T>) => {
      const registration = active().registerState(id, spec);
      return { ...state<T>(id)!, dispose: () => registration.dispose() };
    },
    state,
    onDidRequestRefresh: refreshRequested.event,
    refresh: () => active().refresh(),
    requestParams: () => active().requestParams(),
    dispose: () => dispose.dispose(),
  };
}
