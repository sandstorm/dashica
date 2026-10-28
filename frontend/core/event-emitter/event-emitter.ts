import { Disposable } from '../disposable/disposable';

/**
 * One event: the owner keeps the emitter and calls `fire`; everyone else subscribes through `event`. Listeners run in
 * the order they subscribed; one unsubscribed while the event fires is skipped.
 */
export class EventEmitter<T> {
  readonly #listeners = new Set<(value: T) => void>();

  readonly event: Event<T> = (listener) => {
    // a wrapper per subscription: the same function may subscribe twice and unsubscribe once
    const entry = (value: T) => listener(value);
    this.#listeners.add(entry);
    return new Disposable(() => this.#listeners.delete(entry));
  };

  fire(value: T): void {
    for (const listener of [...this.#listeners]) if (this.#listeners.has(listener)) listener(value);
  }

  get hasListeners(): boolean {
    return this.#listeners.size > 0;
  }

  dispose(): void {
    this.#listeners.clear();
  }
}

/** Subscribes `listener`; disposing the result unsubscribes it. */
export type Event<T> = (listener: (value: T) => void) => Disposable;
