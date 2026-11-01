// See WindowLayout in window-layout.ts.

import { Disposable } from '../../../core/disposable/disposable';
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import { html } from 'htl';
import { Ellipsis, createElement } from 'lucide';
import type { CommandEnablement, MenuItem } from '../../commands/commands';
import type { ContextMenuOptions, Panel, RailButtonOptions, SidePanelOptions } from '../ui';

/**
 * One side of the workbench (left or right): its rail (a button per panel and per command put there, by `order`, in its
 * top or bottom group) and at most one panel shown, sized by a separator on the panel's inner edge (drag or arrow keys;
 * remembered). A panel shows under a header with its name (in caps) and "…", its menu `panel/<id>`, which always holds
 * "Hide" (its command `workbench.view.<id>.hide`). Which panel
 * shows: the viewer's pick (a rail button; clicking the shown panel's button hides the side), else the side's default
 * panel, else the first panel whose owner asked for it (`setDefault`). As an overlay (`setOverlay`, the narrow
 * workbench's left side) a pick lasts for the moment only, and Escape, a click outside or `dismiss()` close the panel.
 * Each panel's command `workbench.view.<id>` picks it from the keyboard; its rail button's tooltip names the key, as a
 * command button's names its command's; a button whose command cannot run now shows greyed.
 */
export class SideBar {
  readonly sideBarContainer: HTMLElement;
  /** The rail's start, before its buttons: what the layout's owner puts there (the left one: the global menu's "…"). */
  readonly railStartContainer: HTMLElement;
  readonly #railContainer: HTMLElement;
  /** The rail's buttons at its far end (`alignment: 'bottom'`); the others go before it. */
  readonly #bottomContainer: HTMLElement;
  /** Each rail button's `order`. */
  readonly #orders = new WeakMap<Element, number>();
  readonly #panelContainer: HTMLElement;
  readonly #resizerElement: HTMLElement;
  readonly #panels = new Map<string, PanelEntry>();
  /** The rail's command buttons (`addButton`). */
  readonly #buttons = new Set<HTMLElement>();
  readonly #size: (typeof SIZES)[Side];
  #shown: string | null = null;
  #defaultPanel: string | null | undefined;
  #overlay = false;
  /** Where the focus was before a panel's command focused it, to go back there when the command hides it. */
  #returnFocusElement: HTMLElement | null = null;
  readonly #cleanup: (() => void)[] = [];

  constructor(
    private readonly hostContainer: HTMLElement,
    readonly side: Side,
    /** Restored from what the viewer had; changed in place, then `owner.save` is called. */
    readonly state: SideBarState,
    private readonly owner: SideBarOwner,
  ) {
    this.#size = SIZES[side];
    this.state.size = this.#clamp(state.size);
    this.railStartContainer = html`<div class="d-workbench__rail-start"></div>`;
    this.#bottomContainer = html`<div class="d-workbench__rail-bottom"></div>`;
    this.#railContainer = html`<div class="d-workbench__rail" role="toolbar" aria-label=${side === 'left' ? 'Left panels' : 'Right panels'} aria-orientation="vertical">${this.railStartContainer}${this.#bottomContainer}</div>`;
    this.#resizerElement = this.#createResizer();
    this.#panelContainer = html`<div class="d-workbench__panel">${this.#resizerElement}</div>`;
    const onkeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && this.#overlay && this.#shown) this.#closeFromKeyboard();
    };
    // the rail on the workbench's outer edge
    const [firstElement, secondElement] = side === 'left' ? [this.#railContainer, this.#panelContainer] : [this.#panelContainer, this.#railContainer];
    this.sideBarContainer = html`<div class="d-workbench__side d-workbench__side--${side}" onkeydown=${onkeydown}>${firstElement}${secondElement}</div>`;
    this.#listen(hostContainer.ownerDocument, 'pointerdown', (event) => {
      if (this.#overlay && this.#shown && !event.composedPath().includes(this.sideBarContainer)) this.show(null);
    });
    this.layout();
  }

  has(id: string): boolean {
    return this.#panels.has(id);
  }

  addPanel(id: string, options: SidePanelOptions): Panel {
    const command = `workbench.view.${id}`;
    const hide = `${command}.hide`;
    const menu = `panel/${id}`;
    const suffix = Math.random().toString(36).slice(2, 8);
    const bodyContainer = html`<div class="d-workbench__panel-body" id=${`wb-panel-${id}-${suffix}`} data-panel=${id}
      aria-labelledby=${`wb-panel-title-${id}-${suffix}`}></div>`;
    const buttonElement = this.#railButton(options, command, () => this.#choose(this.#shown === id ? null : id));
    buttonElement.setAttribute('aria-controls', bodyContainer.id);
    buttonElement.dataset.testid = `wb-panel-toggle-${id}`;
    const actionsButtonElement: HTMLButtonElement = html`<button type="button" class="d-workbench__panel-actions" aria-label=${`${options.label} actions`}
      title="More actions" aria-haspopup="dialog" onclick=${() => this.owner.menus.showContextMenu(menu, { anchor: actionsButtonElement, title: options.label })}></button>`;
    actionsButtonElement.append(createElement(Ellipsis, { width: 16, height: 16 }));
    const headerContainer = html`<div class="d-workbench__panel-header" data-testid=${`wb-panel-header-${id}`}>
      <h2 class="d-workbench__panel-title" id=${`wb-panel-title-${id}-${suffix}`}>${options.label}</h2>${actionsButtonElement}
    </div>`;
    this.#place(buttonElement, options.order ?? 0, options.alignment === 'bottom');
    this.#panelContainer.insertBefore(headerContainer, this.#resizerElement);
    this.#panelContainer.insertBefore(bodyContainer, this.#resizerElement);
    const registration = Disposable.from(
      this.owner.commands.registerCommand(command, () => this.#toggleFocus(id)),
      this.owner.commands.registerCommand(hide, () => {
        if (this.#shown === id) this.#choose(null);
      }),
      this.owner.menus.registerMenuItem(menu, { command: hide, title: 'Hide', group: 'panel' }),
    );
    const entry: PanelEntry = { bodyContainer, headerContainer, buttonElement, registration, fallback: false, available: true, visible: false, visibility: new EventEmitter<void>() };
    this.#panels.set(id, entry);
    this.layout();
    return {
      bodyContainer,
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

  /** Adds a rail button running `options.command`, until disposed. */
  addButton(id: string, options: RailButtonOptions): Disposable {
    const buttonElement = this.#railButton(options, options.command, () => {
      this.owner.commands.executeCommand(options.command).catch((error: unknown) => console.error(`Command ${options.command} failed:`, error));
    });
    buttonElement.dataset.testid = `wb-rail-button-${id}`;
    this.#place(buttonElement, options.order ?? 0, options.alignment === 'bottom');
    this.#buttons.add(buttonElement);
    this.layout();
    return new Disposable(() => {
      if (!this.#buttons.delete(buttonElement)) return;
      buttonElement.remove();
      this.layout();
    });
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
    this.sideBarContainer.hidden = this.#buttons.size === 0 && ![...this.#panels.values()].some((panel) => panel.available);
    for (const [panelId, panel] of this.#panels) {
      panel.buttonElement.hidden = !panel.available;
      panel.buttonElement.setAttribute('aria-pressed', String(panelId === id));
      panel.bodyContainer.hidden = panelId !== id;
      panel.headerContainer.hidden = panelId !== id;
    }
    this.#panelContainer.hidden = id === null;
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
    this.sideBarContainer.remove();
    this.hostContainer.style.removeProperty('--d-workbench-right-side');
  }

  /**
   * A rail button with `options`' icon, running `click`; its tooltip names `command`'s key, asked anew whenever the
   * tooltip may show (the key may be bound after the button is added). While `command` cannot run
   * (`Commands.enablement`, asked then too) it shows greyed, its tooltip says why and a click does nothing.
   */
  #railButton(options: { label: string; icon: string }, command: string, click: () => void): HTMLButtonElement {
    const describe = () => {
      const key = this.owner.commands.keybindingLabel(command);
      const { enabled, disabledReason } = this.owner.commands.enablement(command);
      const title = key ? `${options.label} (${key})` : options.label;
      buttonElement.title = disabledReason ? `${title}: ${disabledReason}` : title;
      if (enabled) buttonElement.removeAttribute('aria-disabled');
      else buttonElement.setAttribute('aria-disabled', 'true');
      return enabled;
    };
    const onclick = () => {
      if (describe()) click();
    };
    const buttonElement = html<HTMLButtonElement>`<button type="button" class="d-workbench__rail-button" aria-label=${options.label}
      onpointerenter=${describe} onfocus=${describe} onclick=${onclick}></button>`;
    describe();
    buttonElement.insertAdjacentHTML('beforeend', options.icon);
    return buttonElement;
  }

  /**
   * Inserts `buttonElement` into the rail's top or bottom group, before the first of its buttons with a higher order
   * (the rail's start has none, so it stays first).
   */
  #place(buttonElement: HTMLElement, order: number, bottom: boolean): void {
    this.#orders.set(buttonElement, order);
    const groupContainer = bottom ? this.#bottomContainer : this.#railContainer;
    const nextElement = [...groupContainer.children].find((otherElement) => (this.#orders.get(otherElement) ?? -Infinity) > order);
    groupContainer.insertBefore(buttonElement, nextElement ?? (bottom ? null : this.#bottomContainer));
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
    const root = this.hostContainer.getRootNode() as Document | ShadowRoot;
    const bodyContainer = this.#panels.get(id)!.bodyContainer;
    if (!bodyContainer.contains(root.activeElement)) this.#returnFocusElement = root.activeElement instanceof HTMLElement ? root.activeElement : null;
    const targetElement = bodyContainer.querySelector<HTMLElement>('[autofocus]') ?? bodyContainer.querySelector<HTMLElement>(FOCUSABLE) ?? bodyContainer;
    if (targetElement === bodyContainer) bodyContainer.tabIndex = -1;
    targetElement.focus();
  }

  /** `workbench.view.<id>`: shows and focuses panel `id`, or hides the side while it is shown and has the focus. */
  #toggleFocus(id: string): void {
    const bodyContainer = this.#panels.get(id)?.bodyContainer;
    const root = this.hostContainer.getRootNode() as Document | ShadowRoot;
    if (this.#shown !== id || !bodyContainer?.contains(root.activeElement)) return this.#reveal(id, false);
    this.#choose(null);
    if (this.#returnFocusElement?.isConnected) this.#returnFocusElement.focus();
    this.#returnFocusElement = null;
  }

  #dismiss(): void {
    if (this.#overlay && this.#shown) this.show(null);
  }

  #remove(id: string): void {
    const panel = this.#panels.get(id);
    if (!panel) return;
    panel.bodyContainer.remove();
    panel.headerContainer.remove();
    panel.buttonElement.remove();
    panel.registration.dispose();
    panel.visibility.dispose();
    this.#panels.delete(id);
    if (this.#shown === id) this.#shown = null;
    this.layout();
  }

  #closeFromKeyboard(): void {
    const buttonElement = this.#shown ? this.#panels.get(this.#shown)?.buttonElement : null;
    this.show(null);
    buttonElement?.focus();
  }

  #applySize(): void {
    const size = this.state.size;
    if (this.#size.unit === 'px') this.#panelContainer.style.width = `${size}px`;
    else if (this.#shown === null) this.hostContainer.style.removeProperty('--d-workbench-right-side');
    else this.hostContainer.style.setProperty('--d-workbench-right-side', `minmax(0, ${size}%)`);
    this.#resizerElement.setAttribute('aria-valuenow', String(size));
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
      const start = { x: event.clientX, size: this.state.size, width: this.hostContainer.getBoundingClientRect().width || 1 };
      const perPixel = this.#size.unit === 'px' ? 1 : 100 / start.width;
      this.#track(event, (e) => this.#resize(start.size + (e.clientX - start.x) * outwards * perPixel));
    };
    return html`<div class="d-workbench__resizer" role="separator" aria-orientation="vertical" aria-label=${label}
      aria-valuemin=${min} aria-valuemax=${max} tabindex="0" onkeydown=${onkeydown} onpointerdown=${onpointerdown}></div>`;
  }

  /** Follows the pointer from `event` until it is released, calling `move` (a resize in progress). */
  #track(event: PointerEvent, move: (event: PointerEvent) => void): void {
    event.preventDefault();
    const doc = this.hostContainer.ownerDocument;
    const up = () => {
      doc.removeEventListener('pointermove', move);
      doc.removeEventListener('pointerup', up);
      this.hostContainer.classList.remove('d-workbench--resizing');
    };
    this.hostContainer.classList.add('d-workbench--resizing');
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

/** What a side needs of the whole layout: to save the state of both sides, the commands and the menus. */
export interface SideBarOwner {
  save(): void;
  readonly commands: PanelCommands;
  readonly menus: PanelMenus;
}

/** What a side needs of the commands: to register a panel's, run a rail button's, the label of a key, whether one can run. */
export interface PanelCommands {
  registerCommand(id: string, handler: () => void): Disposable;
  executeCommand(id: string): Promise<unknown>;
  keybindingLabel(id: string): string | undefined;
  enablement(id: string): CommandEnablement;
}

/** What a panel's "…" needs of the menus: to add "Hide" to its menu and to show it. */
export interface PanelMenus {
  registerMenuItem(menuId: string, item: MenuItem): Disposable;
  showContextMenu(menuId: string, options: ContextMenuOptions): void;
}

interface PanelEntry {
  bodyContainer: HTMLElement;
  /** Its name and "…", above `bodyContainer`. */
  headerContainer: HTMLElement;
  buttonElement: HTMLButtonElement;
  /** Its commands `workbench.view.<id>` and `.hide`, and "Hide" in its menu. */
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
