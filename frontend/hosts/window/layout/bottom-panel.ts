// See WindowLayout in window-layout.ts.

import type { Disposable } from '../../../core/disposable/disposable';
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import type { BottomPanelOptions, Panel } from '../window';
import { div } from '../../../core/dom/dom';
import type { SideBarOwner } from './side-bar';

/**
 * The panel area below the content: a tab per panel (by `order`) and a close button, at most one panel shown, its
 * height set by a separator on its top edge (drag or arrow keys; remembered). Which panel shows: the viewer's pick (a
 * tab; the close button hides the area), else the first panel whose owner asked for it (`setDefault`). Hidden while it
 * shows none. Each panel's command `workbench.view.<id>` shows and focuses it, or hides the area while it has the focus.
 */
export class BottomPanel {
  readonly element: HTMLElement;
  readonly #tabs: HTMLElement;
  readonly #resizer: HTMLElement;
  readonly #panels = new Map<string, PanelEntry>();
  /** Each tab's `order`. */
  readonly #orders = new WeakMap<Element, number>();
  #shown: string | null = null;

  constructor(
    private readonly host: HTMLElement,
    /** Restored from what the viewer had; changed in place, then `owner.save` is called. */
    readonly state: BottomPanelState,
    private readonly owner: SideBarOwner,
  ) {
    const doc = host.ownerDocument;
    this.state.size = clamp(state.size);
    this.element = div(doc, 'dashica-wb__bottom');
    this.#resizer = this.#createResizer();
    const header = div(doc, 'dashica-wb__bottom-header');
    this.#tabs = div(doc, 'dashica-wb__bottom-tabs');
    this.#tabs.setAttribute('role', 'tablist');
    const close = doc.createElement('button');
    close.type = 'button';
    close.className = 'dashica-wb__bottom-close';
    close.setAttribute('aria-label', 'Close panel');
    close.title = 'Close panel';
    close.textContent = '✕';
    close.addEventListener('click', () => this.#choose(null));
    header.append(this.#tabs, close);
    this.element.append(this.#resizer, header);
    this.layout();
  }

  /** The state as stored (`value` comes from storage: any shape), with what is missing or malformed left out. */
  static restoreState(value: unknown): BottomPanelState {
    const saved = isRecord(value) && isRecord(value.bottom) ? value.bottom : {};
    const chosen = typeof saved.chosen === 'string' || saved.chosen === null ? saved.chosen : undefined;
    return { size: typeof saved.size === 'number' ? saved.size : SIZE.initial, chosen };
  }

  has(id: string): boolean {
    return this.#panels.has(id);
  }

  addPanel(id: string, options: BottomPanelOptions): Panel {
    const doc = this.host.ownerDocument;
    const body = div(doc, 'dashica-wb__bottom-body');
    body.id = `wb-panel-${id}-${Math.random().toString(36).slice(2, 8)}`;
    body.dataset.panel = id;
    body.setAttribute('role', 'tabpanel');
    const tab = doc.createElement('button');
    tab.type = 'button';
    tab.className = 'dashica-wb__bottom-tab';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', body.id);
    tab.dataset.testid = `wb-panel-toggle-${id}`;
    tab.textContent = options.label;
    const command = `workbench.view.${id}`;
    // the key may be bound after the panel is added: named anew whenever the tooltip may show
    const describe = () => {
      const key = this.owner.commands.keybindingLabel(command);
      tab.title = key ? `${options.label} (${key})` : options.label;
    };
    describe();
    tab.addEventListener('pointerenter', describe);
    tab.addEventListener('focus', describe);
    tab.addEventListener('click', () => this.#choose(id));
    this.#orders.set(tab, options.order ?? 0);
    const next = [...this.#tabs.children].find((other) => (this.#orders.get(other) ?? -Infinity) > (options.order ?? 0));
    this.#tabs.insertBefore(tab, next ?? null);
    this.element.append(body);
    const registration = this.owner.commands.registerCommand(command, () => this.#toggleFocus(id));
    const entry: PanelEntry = { body, tab, registration, fallback: false, available: true, visible: false, visibility: new EventEmitter<void>() };
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
      dismiss: () => {},
      dispose: () => this.#remove(id),
    };
  }

  /** Shows the panel the viewer picked, else the first that asked for it. */
  layout(): void {
    this.#show(this.#resolve());
  }

  dispose(): void {
    this.element.remove();
  }

  #show(id: string | null): void {
    this.#shown = id;
    for (const [panelId, panel] of this.#panels) {
      panel.tab.hidden = !panel.available;
      panel.tab.setAttribute('aria-selected', String(panelId === id));
      panel.body.hidden = panelId !== id;
    }
    this.element.hidden = id === null;
    this.element.style.height = `${this.state.size}px`;
    this.#resizer.setAttribute('aria-valuenow', String(this.state.size));
    // told after the layout is done, so a listener sees it as it is
    for (const [panelId, panel] of this.#panels) {
      const visible = panelId === id && panel.available;
      if (visible === panel.visible) continue;
      panel.visible = visible;
      panel.visibility.fire();
    }
  }

  #resolve(): string | null {
    const chosen = this.state.chosen;
    if (chosen === null) return null;
    if (chosen !== undefined && this.#isAvailable(chosen)) return chosen;
    for (const [id, panel] of this.#panels) if (panel.available && panel.fallback) return id;
    return null;
  }

  #isAvailable(id: string): boolean {
    return this.#panels.get(id)?.available ?? false;
  }

  /** The viewer picks `id` (null: hides the area), remembered. */
  #choose(id: string | null): void {
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

  /** Shows panel `id` as the viewer's pick and, unless `preserveFocus`, focuses its first focusable element, else the panel. */
  #reveal(id: string, preserveFocus: boolean): void {
    if (!this.#isAvailable(id)) return;
    this.#choose(id);
    if (preserveFocus) return;
    const body = this.#panels.get(id)!.body;
    const target = body.querySelector<HTMLElement>(FOCUSABLE) ?? body;
    if (target === body) body.tabIndex = -1;
    target.focus();
  }

  /** `workbench.view.<id>`: shows and focuses panel `id`, or hides the area while it is shown and has the focus. */
  #toggleFocus(id: string): void {
    const body = this.#panels.get(id)?.body;
    if (this.#shown !== id || !body?.contains(this.host.ownerDocument.activeElement)) return this.#reveal(id, false);
    this.#choose(null);
  }

  #remove(id: string): void {
    const panel = this.#panels.get(id);
    if (!panel) return;
    panel.body.remove();
    panel.tab.remove();
    panel.registration.dispose();
    panel.visibility.dispose();
    this.#panels.delete(id);
    this.layout();
  }

  #resize(size: number): void {
    this.state.size = clamp(size);
    this.owner.save();
    this.layout();
  }

  /** The top edge: drag (or arrow keys) to size the area; up makes it taller. */
  #createResizer(): HTMLElement {
    const resizer = div(this.host.ownerDocument, 'dashica-wb__bottom-resizer');
    resizer.setAttribute('role', 'separator');
    resizer.setAttribute('aria-orientation', 'horizontal');
    resizer.setAttribute('aria-label', 'Bottom panel height');
    resizer.setAttribute('aria-valuemin', String(SIZE.min));
    resizer.setAttribute('aria-valuemax', String(SIZE.max));
    resizer.tabIndex = 0;
    resizer.addEventListener('keydown', (event) => {
      const direction = { ArrowUp: 1, ArrowDown: -1 }[event.key];
      if (direction === undefined) return;
      event.preventDefault();
      this.#resize(this.state.size + direction * SIZE.step);
    });
    resizer.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      const doc = this.host.ownerDocument;
      const start = { y: event.clientY, size: this.state.size };
      const move = (e: PointerEvent) => this.#resize(start.size + start.y - e.clientY);
      const up = () => {
        doc.removeEventListener('pointermove', move);
        doc.removeEventListener('pointerup', up);
        this.host.classList.remove('dashica-wb--resizing-rows');
      };
      this.host.classList.add('dashica-wb--resizing-rows');
      doc.addEventListener('pointermove', move);
      doc.addEventListener('pointerup', up);
    });
    return resizer;
  }
}

/** What the bottom panel keeps for the viewer: its height, and the panel picked (null: closed; undefined: none yet). */
export interface BottomPanelState {
  size: number;
  chosen?: string | null;
}

interface PanelEntry {
  body: HTMLElement;
  tab: HTMLButtonElement;
  /** Its command `workbench.view.<id>`. */
  registration: Disposable;
  fallback: boolean;
  available: boolean;
  /** As told last through `visibility`. */
  visible: boolean;
  visibility: EventEmitter<void>;
}

/** The height in pixels. */
const SIZE = { min: 120, max: 1200, initial: 360, step: 16 } as const;

function clamp(size: number): number {
  return Math.round(Math.min(SIZE.max, Math.max(SIZE.min, size)));
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
