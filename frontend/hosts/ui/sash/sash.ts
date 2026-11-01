import { EventEmitter, type Event } from '../../../core/event-emitter/event-emitter';
import './sash.css';

/**
 * A line between two parts of the screen that the viewer drags (or moves with the arrow keys) to size one of them, as
 * the side bars' inner edges and the line below Explore's SQL editor. It keeps the size within `min` and `max` and
 * says each change (`onDidChange`); its owner applies the size and keeps it (a side bar's state, an extension's
 * `globalState`). Its element, `role=separator` with `aria-valuenow`, goes where its owner places it.
 */
export class Sash {
  readonly sashElement: HTMLElement;
  readonly #changes = new EventEmitter<number>();
  /** Fires with the new size when the viewer moved the sash. */
  readonly onDidChange: Event<number> = this.#changes.event;
  #size: number;
  #stopDrag: (() => void) | undefined;

  constructor(private readonly options: SashOptions) {
    this.#size = this.#clamp(options.size);
    const { orientation, label, min, max } = options;
    const sashElement = options.ownerDocument.createElement('div');
    sashElement.className = `d-sash d-sash--${orientation}`;
    sashElement.tabIndex = 0;
    sashElement.setAttribute('role', 'separator');
    // a separator's orientation is its line's: a vertical line sizes what lies left and right of it
    sashElement.setAttribute('aria-orientation', orientation);
    sashElement.setAttribute('aria-label', label);
    sashElement.setAttribute('aria-valuemin', String(min));
    sashElement.setAttribute('aria-valuemax', String(max));
    sashElement.addEventListener('keydown', (event) => this.#key(event));
    sashElement.addEventListener('pointerdown', (event) => this.#drag(event));
    this.sashElement = sashElement;
    this.#showSize();
  }

  /** The size, within `min` and `max`. */
  get size(): number {
    return this.#size;
  }

  dispose(): void {
    this.#stopDrag?.();
    this.#changes.dispose();
    this.sashElement.remove();
  }

  /** ArrowLeft / ArrowRight (a vertical sash) or ArrowUp / ArrowDown (a horizontal one) move it by `step`. */
  #key(event: KeyboardEvent): void {
    const keys: Record<string, number> = this.options.orientation === 'vertical' ? { ArrowLeft: -1, ArrowRight: 1 } : { ArrowUp: -1, ArrowDown: 1 };
    const direction = keys[event.key];
    if (direction === undefined) return;
    event.preventDefault();
    this.#resize(this.#shownSize() + direction * this.#grows() * this.options.step);
  }

  /** Follows the pointer from `event` until it is released, the size moving with it. */
  #drag(event: PointerEvent): void {
    event.preventDefault();
    const vertical = this.options.orientation === 'vertical';
    const start = { at: vertical ? event.clientX : event.clientY, size: this.#shownSize(), perPixel: this.options.perPixel?.() ?? 1 };
    const doc = this.options.ownerDocument;
    const move = (moved: PointerEvent) => {
      const at = vertical ? moved.clientX : moved.clientY;
      this.#resize(start.size + (at - start.at) * this.#grows() * start.perPixel);
    };
    const stop = () => {
      doc.removeEventListener('pointermove', move);
      doc.removeEventListener('pointerup', stop);
      this.sashElement.classList.remove('d-sash--active');
      doc.documentElement.classList.remove(`d-sash-dragging--${this.options.orientation}`);
      this.#stopDrag = undefined;
    };
    this.#stopDrag?.();
    this.#stopDrag = stop;
    this.sashElement.classList.add('d-sash--active');
    doc.documentElement.classList.add(`d-sash-dragging--${this.options.orientation}`);
    doc.addEventListener('pointermove', move);
    doc.addEventListener('pointerup', stop);
  }

  /** 1: moving the sash right or down makes the size larger; -1: left or up does. */
  #grows(): number {
    return this.options.reverse ? -1 : 1;
  }

  /** Where a move starts: the size as shown (`options.shownSize`), else the size kept. */
  #shownSize(): number {
    const shown = this.options.shownSize?.();
    return shown ? this.#clamp(shown) : this.#size;
  }

  #resize(size: number): void {
    const clamped = this.#clamp(size);
    if (clamped === this.#size) return;
    this.#size = clamped;
    this.#showSize();
    this.#changes.fire(clamped);
  }

  #showSize(): void {
    this.sashElement.setAttribute('aria-valuenow', String(this.#size));
  }

  #clamp(size: number): number {
    return Math.round(Math.min(this.options.max, Math.max(this.options.min, size)));
  }
}

export interface SashOptions {
  /** `vertical`: a vertical line, dragged left and right; `horizontal`: a horizontal one, dragged up and down. */
  readonly orientation: 'vertical' | 'horizontal';
  /** What it sizes, for a screen reader ("Left panel width"). */
  readonly label: string;
  /** The size it starts at (a remembered one), brought within `min` and `max`. */
  readonly size: number;
  readonly min: number;
  readonly max: number;
  /** How much an arrow key changes the size. */
  readonly step: number;
  /** Moving the sash left or up makes the size larger (the edge of a part right of or below it). */
  readonly reverse?: boolean;
  /** How much the size changes per pixel the pointer moves (1: a size in pixels), asked at each drag's start. */
  readonly perPixel?: () => number;
  /**
   * The size as shown now, where a drag or key starts from, when the screen may show less than the size kept (a
   * stylesheet's `max-height`); 0 or none: the size kept.
   */
  readonly shownSize?: () => number;
  /** Whose pointer events a drag follows. */
  readonly ownerDocument: Document;
}
