// See UiApi in ../ui.ts.
import { html } from 'htl';
import { Disposable } from '../../../core/disposable/disposable';
import type { BarPlacement, UiApi } from '../ui';

/**
 * The items of one bar (top, filter or status): `left` from its start, `center` in the middle, `right` at its end;
 * within a side the higher `priority` further left (default 0), equal priorities in registration order. The bar is
 * hidden while it has no item, unless it holds a fixed part between its `left` and `center` items (the top bar's tabs).
 * While `withhold` says so, its items are hidden as if it had none (a popped-out view's tab).
 */
export class Bar {
  readonly #barContainer: HTMLElement;
  readonly #sides: Record<BarPlacement['alignment'], { sideContainer: HTMLElement; entries: Entry[] }>;
  #withheld = false;

  /** Fills `barContainer`, the layout's region; `fixedElement` goes between the `left` and the `center` items. */
  constructor(
    barContainer: HTMLElement,
    private readonly fixedElement?: HTMLElement,
  ) {
    this.#barContainer = barContainer;
    const side = (alignment: string) => ({ sideContainer: html`<div class="d-workbench__bar-${alignment}"></div>`, entries: [] as Entry[] });
    this.#sides = { left: side('left'), center: side('center'), right: side('right') };
    barContainer.append(this.#sides.left.sideContainer, ...(fixedElement ? [fixedElement] : []), this.#sides.center.sideContainer, this.#sides.right.sideContainer);
    this.#update();
  }

  /** Shows `itemElement` where `placement` says, until disposed. */
  add(itemElement: HTMLElement, placement: BarPlacement): Disposable {
    const side = this.#sides[placement.alignment];
    const entry = { itemElement, priority: placement.priority ?? 0 };
    // the sort is stable: equal priorities stay in registration order
    side.entries = [...side.entries, entry].sort((a, b) => b.priority - a.priority);
    side.sideContainer.append(...side.entries.map((each) => each.itemElement));
    this.#update();
    return new Disposable(() => {
      if (!side.entries.includes(entry)) return;
      side.entries = side.entries.filter((each) => each !== entry);
      itemElement.remove();
      this.#update();
    });
  }

  /** Hides the items while `withheld`, whatever they are, and shows them again after; the fixed part stays. */
  withhold(withheld: boolean): void {
    this.#withheld = withheld;
    for (const side of Object.values(this.#sides)) side.sideContainer.hidden = withheld;
    this.#update();
  }

  #update(): void {
    this.#barContainer.hidden = !this.fixedElement && (this.#withheld || Object.values(this.#sides).every((side) => side.entries.length === 0));
  }
}

interface Entry {
  readonly itemElement: HTMLElement;
  readonly priority: number;
}
