/**
 * A cleanup that runs once. Every registration and listener returns one; extensions push it into
 * `context.subscriptions`, which the workbench disposes when it goes away. `Disposable.from(a, b)` disposes several,
 * the last first.
 */
export class Disposable {
  static from(...disposables: { dispose(): unknown }[]): Disposable {
    return new Disposable(() => {
      for (const disposable of [...disposables].reverse()) disposable.dispose();
    });
  }

  #callOnDispose: (() => unknown) | null;

  constructor(callOnDispose: () => unknown) {
    this.#callOnDispose = callOnDispose;
  }

  dispose(): void {
    const call = this.#callOnDispose;
    this.#callOnDispose = null;
    call?.();
  }
}
