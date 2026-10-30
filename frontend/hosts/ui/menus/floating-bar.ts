// See UiApi in ../ui.ts.
import { html } from 'htl';
import { Disposable } from '../../../core/disposable/disposable';
import type { CommandsHost } from '../../commands/commands';
import type { FloatingBar, FloatingBarOptions } from '../ui';
import type { Menus } from './menus';

/**
 * What `registerFloatingBar` adds: each bar a `role="toolbar"` row of its menu's entries for the context its owner
 * shows it for, fixed above its anchor (below where there is no room) and kept inside the viewport. It moves with its
 * anchor on scrolling and resizing, follows changes of its menu while it shows, and lies above the bars of a lower
 * `order`. A chosen entry's command runs with the context (a failing one is logged).
 */
export class FloatingBars {
  /** By `order`, then registration: the order their elements have in `host`. */
  readonly #bars: ShownBar<any>[] = [];

  constructor(
    /** Where the bars' elements go. */
    private readonly host: HTMLElement,
    private readonly menus: Menus,
    private readonly commands: Pick<CommandsHost, 'executeCommand'>,
  ) {}

  register<C extends object>(options: FloatingBarOptions<C>): FloatingBar<C> {
    if (this.#bars.some((bar) => bar.options.id === options.id)) throw new Error(`There is a floating bar ${options.id} already`);
    const bar: ShownBar<C> = new ShownBar(options, this.menus, this.commands, (element) => this.#insert(bar, element), () => {
      this.#bars.splice(this.#bars.indexOf(bar), 1);
    });
    const at = this.#bars.findIndex((other) => (other.options.order ?? 0) > (options.order ?? 0));
    this.#bars.splice(at === -1 ? this.#bars.length : at, 0, bar);
    return bar;
  }

  dispose(): void {
    for (const bar of [...this.#bars]) bar.dispose();
  }

  /** Puts `element` of `bar` into the host, before the shown bars of a higher order. */
  #insert(bar: ShownBar<any>, element: HTMLElement): void {
    const above = this.#bars.slice(this.#bars.indexOf(bar) + 1).find((other) => other.element.isConnected);
    this.host.insertBefore(element, above?.element ?? null);
  }
}

/** One registered bar; its element is in the host while it shows. */
class ShownBar<C extends object> implements FloatingBar<C> {
  readonly element: HTMLElement;
  #context: C | undefined;
  #listening: Disposable | undefined;
  readonly #menuChanged: Disposable;

  constructor(
    readonly options: FloatingBarOptions<C>,
    private readonly menus: Menus,
    private readonly commands: Pick<CommandsHost, 'executeCommand'>,
    private readonly insert: (element: HTMLElement) => void,
    private readonly forget: () => void,
  ) {
    this.element = html`<div class="d-workbench__floating-bar" role="toolbar" aria-label=${options.title} data-testid="floating-bar"></div>`;
    this.#menuChanged = menus.onDidChange((menuId) => {
      if (menuId === options.id && this.#context) this.show(this.#context);
    });
  }

  show(context: C): void {
    this.#context = context;
    const items = this.menus.items(this.options.id, context);
    this.element.replaceChildren(
      ...items.map(
        (item) => html`<button type="button" class="d-workbench__floating-bar-item" onclick=${() => this.#run(item.command, context)}>${item.title ?? item.command}</button>`,
      ),
    );
    if (items.length === 0) {
      this.#remove();
      return;
    }
    if (!this.element.isConnected) this.insert(this.element);
    this.#listen();
    this.#place();
  }

  hide(): void {
    this.#context = undefined;
    this.#remove();
  }

  dispose(): void {
    this.hide();
    this.#menuChanged.dispose();
    this.forget();
  }

  #remove(): void {
    this.#listening?.dispose();
    this.#listening = undefined;
    this.element.remove();
  }

  /** Places the bar again whenever the page scrolls (any element in it) or the window resizes. */
  #listen(): void {
    if (this.#listening) return;
    const doc = this.element.ownerDocument;
    const view = doc.defaultView;
    const place = () => this.#place();
    doc.addEventListener('scroll', place, { capture: true, passive: true });
    view?.addEventListener('resize', place);
    this.#listening = new Disposable(() => {
      doc.removeEventListener('scroll', place, { capture: true });
      view?.removeEventListener('resize', place);
    });
  }

  #place(): void {
    if (!this.#context) return;
    const rect = this.options.anchor(this.#context);
    this.element.hidden = rect === null;
    if (rect === null) return;
    const view = this.element.ownerDocument.defaultView;
    const gap = 4;
    const width = this.element.offsetWidth;
    const height = this.element.offsetHeight;
    const above = rect.top - height - gap;
    const y = above >= 0 ? above : rect.bottom + gap;
    const maxX = Math.max(0, (view?.innerWidth ?? 0) - width);
    const maxY = Math.max(0, (view?.innerHeight ?? 0) - height);
    this.element.style.left = `${Math.min(Math.max(rect.left, 0), maxX)}px`;
    this.element.style.top = `${Math.min(Math.max(y, 0), maxY)}px`;
  }

  #run(command: string, context: C): void {
    this.commands.executeCommand(command, context).catch((error: unknown) => console.error(`Command ${command} failed:`, error));
  }
}
