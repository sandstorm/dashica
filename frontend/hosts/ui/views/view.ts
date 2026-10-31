import { html } from 'htl';
import { ChevronRight, createElement } from 'lucide';
import type { Memento } from '../../extension-host/extension-host';
import './view.css';

/** The views drawn so far: each body's id (`d-view-3`), unique in the page. */
let drawn = 0;

/**
 * A view of a panel: a header (a chevron, the title, while closed its description, then its actions) above a body
 * the header opens and closes; several stand one below the other and scroll with the panel, each header staying at
 * the top while its body scrolls past. The title is a button: Enter / Space toggles it, ArrowLeft closes it,
 * ArrowRight opens it (`aria-expanded`). Whether the viewer closed it is kept in `options.state` under
 * `views.<id>.collapsed`, so a view drawn anew (the panel's content redrawn) is as the viewer left it; without `state`
 * it is kept by this element only, and a view drawn anew starts as `collapsed` says.
 */
export function createView(options: ViewOptions): HTMLElement {
  const { id, title, description, actions = [], state, body } = options;
  const key = `views.${id}.collapsed`;
  const bodyEl: HTMLElement = html`<div class="d-view__body" id=${`d-view-${++drawn}`}>${body}</div>`;
  const set = (collapsed: boolean) => {
    view.classList.toggle('d-view--collapsed', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    bodyEl.hidden = collapsed;
  };
  const choose = (collapsed: boolean) => {
    set(collapsed);
    void state?.update(key, collapsed);
  };
  const onkeydown = (event: KeyboardEvent) => {
    const collapsed = ({ ArrowLeft: true, ArrowRight: false } as Record<string, boolean>)[event.key];
    if (collapsed === undefined || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    choose(collapsed);
  };
  const toggle: HTMLButtonElement = html`<button type="button" class="d-view__toggle" aria-controls=${bodyEl.id}
    onclick=${() => choose(toggle.getAttribute('aria-expanded') === 'true')} onkeydown=${onkeydown}>
    ${createElement(ChevronRight, { width: 16, height: 16, class: 'd-view__chevron', 'aria-hidden': 'true' })}
    <span class="d-view__title">${title}</span>
    ${description ? html`<span class="d-view__description">${description}</span>` : ''}
  </button>`;
  const view: HTMLElement = html`<section class="d-view" data-view=${id}>
    <div class="d-view__header">
      <h2 class="d-view__heading">${toggle}</h2>
      ${actions.length > 0 ? html`<div class="d-view__actions">${actions}</div>` : ''}
    </div>
    ${bodyEl}
  </section>`;
  const stored = state?.get<unknown>(key);
  set(typeof stored === 'boolean' ? stored : (options.collapsed ?? false));
  return view;
}

export interface ViewOptions {
  /** Names the view in `state` ("favorites"), unique among the views kept there. */
  readonly id: string;
  /** The header's text ("Favorites"). */
  readonly title: string;
  /** Muted after the title while the view is closed, e.g. how many entries it holds ("3"). */
  readonly description?: string;
  /** Buttons at the header's end. */
  readonly actions?: readonly HTMLElement[];
  /** Closed until the viewer opens it; default open. */
  readonly collapsed?: boolean;
  /**
   * Keeps whether the viewer closed it: the extension's `globalState` (across visits) or `workspaceState`; without
   * one it is not kept.
   */
  readonly state?: Memento;
  /** What the view shows when open. */
  readonly body: Node | readonly Node[];
}
