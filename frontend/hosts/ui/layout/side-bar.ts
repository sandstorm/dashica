// See WindowLayout in window-layout.ts.

import type { Disposable } from '../../../core/disposable/disposable';
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import { html } from 'htl';
import type { Panel, SidePanelOptions } from '../ui';

/**
 * One side of the workbench (left or right): its rail (a button per panel, by `order`, in its top or bottom group) and
 * at most one panel shown, sized by a separator on the panel's inner edge (drag or arrow keys; remembered). Which panel
 * shows: the viewer's pick (a rail button; clicking the shown panel's button hides the side), else the side's default
 * panel, else the first panel whose owner asked for it (`setDefault`). As an overlay (`setOverlay`, the narrow
 * workbench's left side) a pick lasts for the moment only, and Escape, a click outside or `dismiss()` close the panel.
 * Each panel's command `workbench.view.<id>` picks it from the keyboard; its rail button's tooltip names the key.
 */
export class SideBar {
  readonly element: HTMLElement;
  readonly #rail: HTMLElement;
  /** The rail's buttons at its far end (`alignment: 'bottom'`); the others go before it. */
  readonly #bottom: HTMLElement;
  /** Each rail button's `order`. */
  readonly #orders = new WeakMap<Element, number>();
  readonly #panel: HTMLElement;
  readonly #resizer: HTMLElement;
  readonly #panels = new Map<string, PanelEntry>();
  readonly #size: (typeof SIZES)[Side];
  #shown: string | null = null;
  #defaultPanel: string | null | undefined;
  #overlay = false;
  /** Where the focus was before a panel's command focused it, to go back there when the command hides it. */
  #returnFocus: HTMLElement | null = null;
  readonly #cleanup: (() => void)[] = [];

  constructor(
    private readonly host: HTMLElement,
    readonly side: Side,
    /** Restored from what the viewer had; changed in place, then `owner.save` is called. */
    readonly state: SideBarState,
    private readonly owner: SideBarOwner,
  ) {
    this.#size = SIZES[side];
    this.state.size = this.#clamp(state.size);
    this.#bottom = html`<div class="d-workbench__rail-bottom"></div>`;
    this.#rail = html`<div class="d-workbench__rail" role="toolbar" aria-label=${side === 'left' ? 'Left panels' : 'Right panels'} aria-orientation="vertical">${this.#bottom}</div>`;
    this.#resizer = this.#createResizer();
    this.#panel = html`<div class="d-workbench__panel">${this.#resizer}</div>`;
    const onkeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && this.#overlay && this.#shown) this.#closeFromKeyboard();
    };
    // the rail on the workbench's outer edge
    const [first, second] = side === 'left' ? [this.#rail, this.#panel] : [this.#panel, this.#rail];
    this.element = html`<div class="d-workbench__side d-workbench__side--${side}" onkeydown=${onkeydown}>${first}${second}</div>`;
    this.#listen(host.ownerDocument, 'pointerdown', (event) => {
      if (this.#overlay && this.#shown && !event.composedPath().includes(this.element)) this.show(null);
    });
    this.layout();
  }

  has(id: string): boolean {
    return this.#panels.has(id);
  }

  addPanel(id: string, options: SidePanelOptions): Panel {
    const command = `workbench.view.${id}`;
    const body = html`<div class="d-workbench__panel-body" id=${`wb-panel-${id}-${Math.random().toString(36).slice(2, 8)}`} data-panel=${id}></div>`;
    // the key may be bound after the panel is added: named anew whenever the tooltip may show
    const describe = () => {
      const key = this.owner.commands.keybindingLabel(command);
      button.title = key ? `${options.label} (${key})` : options.label;
    };
    const button = html<HTMLButtonElement>`<button type="button" class="d-workbench__rail-button" aria-label=${options.label}
      aria-controls=${body.id} data-testid=${`wb-panel-toggle-${id}`} onpointerenter=${describe} onfocus=${describe}
      onclick=${() => this.#choose(this.#shown === id ? null : id)}></button>`;
    describe();
    button.insertAdjacentHTML('beforeend', options.icon);
    this.#place(button, options.order ?? 0, options.alignment === 'bottom');
    this.#panel.insertBefore(body, this.#resizer);
    const registration = this.owner.commands.registerCommand(command, () => this.#toggleFocus(id));
    const entry: PanelEntry = { body, button, registration, fallback: false, available: true, visible: false, visibility: new EventEmitter<void>() };
    this.#panels.set(id, entry);
    this.layout();
    return {
      body,
      get visible() {
        return entry.visible;
      },
      onDidChangeVisibility: entry.visibility.event,
      setDefault: (open) => this.#update(id, { fallback: open }),
      setAvailable: (available) => this.#update(id, { available }),
      show: (preserveFocus) => this.#reveal(id, preserveFocus ?? false),
      hide: () => {
        if (this.#shown === id) this.#choose(null);
      },
      dismiss: () => this.#dismiss(),
      dispose: () => this.#remove(id),
    };
  }

  /** The panel the side shows until the viewer picks one (null: none), before any panel's `setDefault`; undefined: no such panel. */
  setDefaultPanel(id: string | null | undefined): void {
    this.#defaultPanel = id;
    this.layout();
  }

  /** As an overlay a pick is for the moment only; becoming one closes the panel instead of covering the content. */
  setOverlay(overlay: boolean): void {
    this.#overlay = overlay;
    if (overlay) this.show(null);
    else this.layout();
  }

  /** Shows the panel the viewer picked, else the default; as an overlay only the one opened now. */
  layout(): void {
    if (this.#overlay) return this.show(this.#shown && this.#isAvailable(this.#shown) ? this.#shown : null);
    this.show(this.#resolve());
  }

  show(id: string | null): void {
    this.#shown = id;
    this.element.hidden = ![...this.#panels.values()].some((panel) => panel.available);
    for (const [panelId, panel] of this.#panels) {
      panel.button.hidden = !panel.available;
      panel.button.setAttribute('aria-pressed', String(panelId === id));
      panel.body.hidden = panelId !== id;
    }
    this.#panel.hidden = id === null;
    this.#applySize();
    // told after the layout is done, so a listener sees it as it is
    for (const [panelId, panel] of this.#panels) {
      const visible = panelId === id && panel.available;
      if (visible === panel.visible) continue;
      panel.visible = visible;
      panel.visibility.fire();
    }
  }

  dispose(): void {
    for (const stop of this.#cleanup) stop();
    this.element.remove();
    this.host.style.removeProperty('--d-workbench-right-side');
  }

  /** Inserts `button` into the rail's top or bottom group, before the first of its buttons with a higher order. */
  #place(button: HTMLElement, order: number, bottom: boolean): void {
    this.#orders.set(button, order);
    const group = bottom ? this.#bottom : this.#rail;
    const next = [...group.children].find((other) => (this.#orders.get(other) ?? -Infinity) > order);
    group.insertBefore(button, next ?? (bottom ? null : this.#bottom));
  }

  #resolve(): string | null {
    const chosen = this.state.chosen;
    if (chosen === null) return null;
    if (chosen !== undefined && this.#isAvailable(chosen)) return chosen;
    if (this.#defaultPanel === null) return null;
    if (this.#defaultPanel !== undefined && this.#isAvailable(this.#defaultPanel)) return this.#defaultPanel;
    for (const [id, panel] of this.#panels) if (panel.available && panel.fallback) return id;
    return null;
  }

  #isAvailable(id: string): boolean {
    return this.#panels.get(id)?.available ?? false;
  }

  /** The viewer picks `id` (null: hides the side), remembered; as an overlay for the moment only. */
  #choose(id: string | null): void {
    if (this.#overlay) return this.show(id);
    this.state.chosen = id;
    this.owner.save();
    this.layout();
  }

  #update(id: string, change: Partial<Pick<PanelEntry, 'fallback' | 'available'>>): void {
    const panel = this.#panels.get(id);
    if (!panel) return;
    Object.assign(panel, change);
    this.layout();
  }

  /**
   * Shows panel `id` as the viewer's pick and, unless `preserveFocus`, focuses it (where the focus was is remembered):
   * its element marked `autofocus` (as a dialog's), else its first focusable one, else the panel itself.
   */
  #reveal(id: string, preserveFocus: boolean): void {
    if (!this.#isAvailable(id)) return;
    this.#choose(id);
    if (preserveFocus) return;
    const root = this.host.getRootNode() as Document | ShadowRoot;
    const body = this.#panels.get(id)!.body;
    if (!body.contains(root.activeElement)) this.#returnFocus = root.activeElement instanceof HTMLElement ? root.activeElement : null;
    const target = body.querySelector<HTMLElement>('[autofocus]') ?? body.querySelector<HTMLElement>(FOCUSABLE) ?? body;
    if (target === body) body.tabIndex = -1;
    target.focus();
  }

  /** `workbench.view.<id>`: shows and focuses panel `id`, or hides the side while it is shown and has the focus. */
  #toggleFocus(id: string): void {
    const body = this.#panels.get(id)?.body;
    const root = this.host.getRootNode() as Document | ShadowRoot;
    if (this.#shown !== id || !body?.contains(root.activeElement)) return this.#reveal(id, false);
    this.#choose(null);
    if (this.#returnFocus?.isConnected) this.#returnFocus.focus();
    this.#returnFocus = null;
  }

  #dismiss(): void {
    if (this.#overlay && this.#shown) this.show(null);
  }

  #remove(id: string): void {
    const panel = this.#panels.get(id);
    if (!panel) return;
    panel.body.remove();
    panel.button.remove();
    panel.registration.dispose();
    panel.visibility.dispose();
    this.#panels.delete(id);
    if (this.#shown === id) this.#shown = null;
    this.layout();
  }

  #closeFromKeyboard(): void {
    const button = this.#shown ? this.#panels.get(this.#shown)?.button : null;
    this.show(null);
    button?.focus();
  }

  #applySize(): void {
    const size = this.state.size;
    if (this.#size.unit === 'px') this.#panel.style.width = `${size}px`;
    else if (this.#shown === null) this.host.style.removeProperty('--d-workbench-right-side');
    else this.host.style.setProperty('--d-workbench-right-side', `minmax(0, ${size}%)`);
    this.#resizer.setAttribute('aria-valuenow', String(size));
  }

  #clamp(size: number): number {
    return Math.round(Math.min(this.#size.max, Math.max(this.#size.min, size)));
  }

  #resize(size: number): void {
    this.state.size = this.#clamp(size);
    this.owner.save();
    this.#applySize();
  }

  /** The panel's inner edge: drag (or arrow keys) to size the side; the arrow moves the edge. */
  #createResizer(): HTMLElement {
    const { min, max, step, label } = this.#size;
    // moving the edge outwards (away from the side's rail) makes the side wider
    const outwards = this.side === 'left' ? 1 : -1;
    const onkeydown = (event: KeyboardEvent) => {
      const direction = ({ ArrowLeft: -1, ArrowRight: 1 } as Record<string, number>)[event.key];
      if (direction === undefined) return;
      event.preventDefault();
      this.#resize(this.state.size + direction * outwards * step);
    };
    const onpointerdown = (event: PointerEvent) => {
      const start = { x: event.clientX, size: this.state.size, width: this.host.getBoundingClientRect().width || 1 };
      const perPixel = this.#size.unit === 'px' ? 1 : 100 / start.width;
      this.#track(event, (e) => this.#resize(start.size + (e.clientX - start.x) * outwards * perPixel));
    };
    return html`<div class="d-workbench__resizer" role="separator" aria-orientation="vertical" aria-label=${label}
      aria-valuemin=${min} aria-valuemax=${max} tabindex="0" onkeydown=${onkeydown} onpointerdown=${onpointerdown}></div>`;
  }

  /** Follows the pointer from `event` until it is released, calling `move` (a resize in progress). */
  #track(event: PointerEvent, move: (event: PointerEvent) => void): void {
    event.preventDefault();
    const doc = this.host.ownerDocument;
    const up = () => {
      doc.removeEventListener('pointermove', move);
      doc.removeEventListener('pointerup', up);
      this.host.classList.remove('d-workbench--resizing');
    };
    this.host.classList.add('d-workbench--resizing');
    doc.addEventListener('pointermove', move);
    doc.addEventListener('pointerup', up);
  }

  #listen<K extends keyof DocumentEventMap>(doc: Document, type: K, handler: (event: DocumentEventMap[K]) => void): void {
    doc.addEventListener(type, handler, true);
    this.#cleanup.push(() => doc.removeEventListener(type, handler, true));
  }
}

export type Side = 'left' | 'right';

/** What a side keeps for the viewer: its size, and the panel the viewer picked (null: hid the side; undefined: none yet). */
export interface SideBarState {
  size: number;
  chosen?: string | null;
}

/** A side's state as stored (`value` comes from storage: any shape), with what is missing or malformed left out. */
export function restoreSideBarState(value: unknown, side: Side): SideBarState {
  const saved = isRecord(value) && isRecord(value[side]) ? value[side] : {};
  const chosen = typeof saved.chosen === 'string' || saved.chosen === null ? saved.chosen : undefined;
  return { size: typeof saved.size === 'number' ? saved.size : SIZES[side].initial, chosen };
}

/** What a side needs of the whole layout: to save the state of both sides, and the commands. */
export interface SideBarOwner {
  save(): void;
  readonly commands: PanelCommands;
}

/** What a panel needs of the commands: to register its own, and the label of its key. */
export interface PanelCommands {
  registerCommand(id: string, handler: () => void): Disposable;
  keybindingLabel(id: string): string | undefined;
}

interface PanelEntry {
  body: HTMLElement;
  button: HTMLButtonElement;
  /** Its command `workbench.view.<id>`. */
  registration: Disposable;
  fallback: boolean;
  available: boolean;
  /** As told last through `visibility`. */
  visible: boolean;
  visibility: EventEmitter<void>;
}

/**
 * How a side is sized: the left one in pixels (the panel's width), the right one as a share of the workbench in percent
 * (the grid column `--d-workbench-right-side`), so opening the left side narrows only the content.
 */
const SIZES = {
  left: { unit: 'px', min: 200, max: 640, initial: 300, step: 16, label: 'Left panel width' },
  right: { unit: '%', min: 20, max: 80, initial: 50, step: 5, label: 'Right panel width' },
} as const;

/** What can take the focus in a panel: the first of these gets it when the panel is shown from the keyboard. */
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
