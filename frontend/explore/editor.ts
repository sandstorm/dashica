// editor.ts — the Explore editor, built on a reactive dataflow.
//
// Design (per docs §"Frontend architecture revision — reactive dataflow"):
// this is a plain manual-DOM application, NOT idiomatic Alpine — the CSP Alpine
// build forbids expressions with arguments, and a recursive schema-driven form
// cannot be expressed in Alpine templates. But we DO reuse Alpine's reactive
// *engine* (`Alpine.reactive` / `Alpine.effect` / `Alpine.release` — @vue/reactivity
// underneath) headlessly.
//
// Two reactive objects are the single source of truth:
//   • `state` — the dashboard being built (title, layout, widgets[])
//   • `ui`    — transient editor state (selectedId, drawerTab)
// Every derived surface (localStorage, the tree, the inspector, each preview
// card, the JSON drawer) is an *effect* that subscribes to exactly the parts of
// state it reads. Mutations are just mutations; effects notice. There is no
// update()/onEdit() split and controls no longer plumb an onChange callback —
// they write into the (reactive) props object and the relevant effects react.
//
// The classic reactive traps, and how each is handled (see doc guardrails):
//  1. The inspector must depend only on (selectedId, widget.type), never on
//     props values — otherwise typing rebuilds the form under the cursor (the
//     defocus bug reborn). The effect tracks only (selectedId, type) and defers
//     the actual form build to a microtask, which runs with NO active effect, so
//     the controls' reads of props are untracked. Controls stay imperative
//     islands; reactivity coordinates *between* panes, not inside a control.
//  2. Text inputs (title, JSON textarea) are written by their effect only when
//     not focused (`document.activeElement !== el`).
//  3. Previews are commit-driven, not keystroke-driven: each card effect's ONLY
//     dependency is `ui.buildRev`, bumped by an explicit Build (button / Enter /
//     Cmd+Enter) or by undo/redo. The widget props are read *untracked* inside
//     renderCard, which gates on client-side validation before firing a query —
//     so typing never fires a query and never overwrites the last good chart.
//  4. Effect lifecycle is explicit: per-widget effects are kept on the preview
//     entry and `Alpine.release`d on widget removal.
//  5. One effect per pane/widget with a name comment; no nested effects except
//     the deliberate per-card effect created once at mount (commented below).

import Alpine from '@alpinejs/csp';
import {html} from "htl";
import {classBadge, Column, ControlCtx, FieldDescriptor, FieldKind, humanize, kindsForSlot, SchemaResponse} from "./controls";
import {renderForm, WidgetDescriptor} from "./formRenderer";
import {mountPreview, PreviewController, WidgetEnvelope} from "./preview";
import {createFilterScope} from "../store";

interface WidgetState { id: string; type: string; props: Record<string, any>; }
interface DashboardState { title: string; layout: string; widgets: WidgetState[]; }
interface WidgetFormModel extends WidgetDescriptor { defaults: Record<string, any>; }
interface FormModel { widgets: Record<string, WidgetFormModel>; layouts: string[]; fieldKinds: FieldKind[]; }

type DrawerTab = 'data' | 'gocode' | 'json';
// buildRev is the "commit" counter: previews query only when it changes (an
// explicit Build), never on every keystroke — see the preview effect below.
interface UiState { selectedId: string | null; drawerTab: DrawerTab; drawerCollapsed: boolean; buildRev: number; }

interface PreviewEntry {
    card: HTMLElement;
    controller: PreviewController;
    eff: any;                      // the per-widget preview effect (released on teardown)
    lastRendered: string | null;   // JSON of the last envelope sent — skip refetch when unchanged
}

const LS_KEY = 'dashica-explore-state';

function debounce<T extends (...a: any[]) => void>(fn: T, ms = 400): T {
    let t: any;
    return ((...args: any[]) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }) as T;
}

function deepClone<T>(v: T): T { return JSON.parse(JSON.stringify(v)); }

// raw returns the non-reactive target of a reactive proxy, so a read does not
// register a dependency; writes must still go through the proxy to trigger.
function raw<T>(v: T): T { return (Alpine as any).raw ? (Alpine as any).raw(v) : v; }

// validateState turns arbitrary JSON (share link, JSON tab) into a well-formed
// DashboardState or throws — so garbage produces an inline error, never a
// half-applied state that crashes the next render.
function validateState(o: any): DashboardState {
    if (!o || typeof o !== 'object') throw new Error('state must be an object');
    if (o.title != null && typeof o.title !== 'string') throw new Error('title must be a string');
    if (o.layout != null && typeof o.layout !== 'string') throw new Error('layout must be a string');
    if (!Array.isArray(o.widgets)) throw new Error('widgets must be an array');
    const widgets: WidgetState[] = o.widgets.map((w: any, i: number) => {
        if (!w || typeof w !== 'object') throw new Error(`widget ${i} must be an object`);
        if (typeof w.type !== 'string') throw new Error(`widget ${i} missing string "type"`);
        if (!w.props || typeof w.props !== 'object') throw new Error(`widget ${i} missing object "props"`);
        return {id: typeof w.id === 'string' && w.id ? w.id : `w${i}`, type: w.type, props: w.props};
    });
    return {title: o.title ?? 'Untitled', layout: o.layout ?? 'defaultPage', widgets};
}

class Editor {
    private formModel: FormModel | null = null;
    private schema: SchemaResponse | null = null;

    // The two reactive roots (assigned in start(), once Alpine's engine is live).
    private state!: DashboardState;
    private ui!: UiState;
    private idSeq = 0;

    // Non-reactive bookkeeping — one entry per mounted preview card.
    private previews: Record<string, PreviewEntry> = {};

    // The Data-tab sample-rows preview (its own controller, torn down whenever
    // the drawer content is rebuilt).
    private dataPreview: PreviewController | null = null;

    // Effects, kept only so a future teardown could release them.
    private effects: any[] = [];

    // Cached DOM refs into the templ shell + built-once controls.
    private elToolbar: HTMLElement;
    private elTree: HTMLElement;
    private elPreview: HTMLElement;
    private elInspector: HTMLElement;
    private elDrawer: HTMLElement;
    private titleInput!: HTMLInputElement;
    private elTreeList!: HTMLElement;
    private elDrawerTabs!: HTMLElement;
    private elDrawerCollapse!: HTMLButtonElement;
    private elDrawerContent!: HTMLElement;
    private jsonTextarea: HTMLTextAreaElement | null = null;
    private elUndoBtn!: HTMLButtonElement;
    private elRedoBtn!: HTMLButtonElement;
    private elInspectorValidation: HTMLElement | null = null;

    // Undo/redo history: snapshots of the full dashboard state. A snapshot is
    // pushed on every discrete action (add/delete/move) and on Build (which
    // commits the edits typed since the last snapshot). Cmd/Ctrl+Z / Y step it.
    private history: DashboardState[] = [];
    private histIndex = -1;

    private inspectorScheduled = false;

    // Source row index during a tree drag-and-drop reorder (null when not dragging).
    private dragIndex: number | null = null;

    // Last selection we scrolled the preview to — so we only auto-scroll on an
    // actual selection change, not on every structural repaint.
    private lastScrolledSel: string | null = null;

    constructor(private root: HTMLElement, private baseUrl: string) {
        this.elToolbar = root.querySelector('[data-explore="toolbar"]')!;
        this.elTree = root.querySelector('[data-explore="tree"]')!;
        this.elPreview = root.querySelector('[data-explore="preview"]')!;
        this.elInspector = root.querySelector('[data-explore="inspector"]')!;
        this.elDrawer = root.querySelector('[data-explore="drawer"]')!;
    }

    async start() {
        this.ui = Alpine.reactive({selectedId: null, drawerTab: 'data', drawerCollapsed: false, buildRev: 0} as UiState);
        this.state = Alpine.reactive(this.loadState());
        this.reseedIdSeq();
        this.history = [deepClone(this.state)];
        this.histIndex = 0;

        try {
            const [fm, sc] = await Promise.all([
                fetch(`${this.baseUrl}/api/formmodel`).then((r) => { if (!r.ok) throw new Error(`formmodel ${r.status}`); return r.json(); }),
                fetch(`${this.baseUrl}/api/schema`).then((r) => r.ok ? r.json() : null).catch(() => null),
            ]);
            this.formModel = fm;
            this.schema = sc;
        } catch (e: any) {
            this.root.replaceChildren(
                html`<div class="explore-empty">${`Explore API unavailable (${e.message}). Reload to retry.`}</div>`);
            return;
        }

        // Build the static shells once, then wire the effects that keep the
        // dynamic parts in sync. Effect first-runs paint the initial state.
        this.buildToolbar();
        this.buildTreeShell();
        this.buildDrawerShell();
        this.wireFilterToggle();
        this.wireKeyboard();
        this.wireInspectorInteractions();
        this.wireEffects();
        this.updateHistoryButtons();
    }

    // ---- explicit build + keyboard ----------------------------------------

    // Build is the single "run the query" trigger. Preview cards read the widget
    // props untracked and re-render ONLY when ui.buildRev changes, so typing in
    // the inspector never fires a query (fixes the every-keystroke error walls).
    // Build also commits the typed edits to the undo history.
    private build() {
        this.pushHistory();
        this.ui.buildRev++;
        this.refreshValidation();
    }

    private wireKeyboard() {
        document.addEventListener('keydown', (e: KeyboardEvent) => {
            const meta = e.metaKey || e.ctrlKey;
            if (!meta) return;
            const k = e.key.toLowerCase();
            if (k === 'enter') { e.preventDefault(); this.build(); return; }
            if (k === 'z') {
                // Leave native text-undo alone while editing a field (unless it's
                // a redo chord); otherwise step the dashboard history.
                if (!e.shiftKey && this.isTextField(document.activeElement)) return;
                e.preventDefault();
                if (e.shiftKey) this.redo(); else this.undo();
                return;
            }
            if (k === 'y') { e.preventDefault(); this.redo(); }
        });
    }

    private isTextField(el: Element | null): boolean {
        if (!el) return false;
        const tag = el.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable === true;
    }

    // Enter in a single-line inspector input builds the query (the explicit
    // "press Enter to run" affordance); live-validate on every edit so required
    // fields flag immediately without waiting for a build. Delegated on the
    // persistent inspector root so it survives every form rebuild.
    private wireInspectorInteractions() {
        this.elInspector.addEventListener('keydown', (e: KeyboardEvent) => {
            const t = e.target as HTMLElement;
            if (e.key === 'Enter' && t.tagName === 'INPUT') { e.preventDefault(); this.build(); }
        });
        const revalidate = () => this.refreshValidation();
        this.elInspector.addEventListener('input', revalidate);
        this.elInspector.addEventListener('change', revalidate);
    }

    // ---- initial state -----------------------------------------------------

    private loadState(): DashboardState {
        const hash = new URLSearchParams(window.location.hash.slice(1)).get('s');
        if (hash) {
            try { return validateState(JSON.parse(decodeURIComponent(escape(atob(hash))))); }
            catch (e) { console.warn('Explore: ignoring invalid share link', e); }
        }
        const stored = localStorage.getItem(LS_KEY);
        if (stored) {
            try { return validateState(JSON.parse(stored)); } catch { /* ignore */ }
        }
        return {title: 'Untitled', layout: 'defaultPage', widgets: []};
    }

    private reseedIdSeq() {
        for (const w of this.state.widgets) {
            const n = parseInt((w.id || '').replace(/\D/g, ''), 10);
            if (!isNaN(n) && n >= this.idSeq) this.idSeq = n + 1;
        }
    }

    // Replace the reactive state in place (never reassign — effects hold the
    // reference). Used by the JSON tab, share-link apply and undo/redo. Preview
    // cards look their widget up by id at render time, so they rebind to the new
    // widget objects for free; the reconcile effect creates/destroys cards for
    // ids that appeared/vanished. Cards do NOT re-query here — that waits for the
    // next Build (or the buildRev bump undo/redo issues explicitly).
    private applyState(ns: DashboardState) {
        this.state.title = ns.title;
        this.state.layout = ns.layout;
        this.state.widgets.splice(0, this.state.widgets.length, ...ns.widgets);
        this.reseedIdSeq();
    }

    // ---- effects (one per pane/concern; named) -----------------------------

    private wireEffects() {
        // persist: localStorage follows state.
        const persist = debounce((json: string) => localStorage.setItem(LS_KEY, json));
        this.effects.push(Alpine.effect(() => { persist(JSON.stringify(this.state)); }));

        // toolbar sync: title input reflects state when not focused. The layout
        // is not user-editable here (defaults to defaultPage); it round-trips via
        // the JSON tab / share link but has no toolbar control.
        this.effects.push(Alpine.effect(() => {
            const t = this.state.title;
            if (document.activeElement !== this.titleInput) this.titleInput.value = t;
        }));

        // tree: follows widget structure + selection.
        this.effects.push(Alpine.effect(() => {
            const widgets = this.state.widgets;
            const items = widgets.map((w) => ({id: w.id, type: w.type})); // structural dep
            const sel = this.ui.selectedId;                                // selection dep
            this.renderTreeList(items, sel);
        }));

        // inspector: depends ONLY on (selectedId, widget.type). The actual form
        // build is deferred to a microtask so control reads of props are
        // untracked (guardrail 1 — no defocus).
        this.effects.push(Alpine.effect(() => {
            const id = this.ui.selectedId;
            const w = id ? this.state.widgets.find((x) => x.id === id) : null;
            void (w ? w.type : null); // track type; ignore the value here
            this.scheduleInspector();
        }));

        // preview reconcile: create/destroy/reorder cards + selection outline.
        this.effects.push(Alpine.effect(() => {
            const widgets = this.state.widgets;
            const ids = widgets.map((w) => w.id); // structural dep
            const sel = this.ui.selectedId;        // selection dep
            this.reconcilePreviews(widgets, ids, sel);
        }));

        // drawer chrome: tab bar + content pane follow the active tab and the
        // collapsed flag. The Data tab is selection-aware (reads selectedId only
        // in its own branch, so json/gocode don't rebuild on selection changes).
        this.effects.push(Alpine.effect(() => {
            const tab = this.ui.drawerTab;
            const collapsed = this.ui.drawerCollapsed;
            this.updateDrawerTabs(tab, collapsed);
            if (this.dataPreview) { this.dataPreview.destroy(); this.dataPreview = null; }
            this.elDrawerContent.innerHTML = '';
            this.jsonTextarea = null;
            if (collapsed) return; // content hidden — skip building it
            if (tab === 'json') this.buildJsonTab(this.elDrawerContent);
            else if (tab === 'gocode') this.buildGocodeTab(this.elDrawerContent);
            else this.buildDataTab(this.elDrawerContent, this.ui.selectedId); // data: selection dep
        }));

        // json live sync: the textarea reflects state when the json tab is open
        // and unfocused — this is what fixes stale JSON-tab content for free.
        this.effects.push(Alpine.effect(() => {
            const json = JSON.stringify(this.state, null, 2); // deep dep on state
            const ta = this.jsonTextarea;
            if (this.ui.drawerTab === 'json' && ta && document.activeElement !== ta) ta.value = json;
        }));
    }

    // ---- toolbar -----------------------------------------------------------

    private buildToolbar() {
        this.titleInput = html`<input class="explore-input explore-toolbar__title" placeholder="Dashboard title"
            oninput=${() => { this.state.title = this.titleInput.value; }}>` as HTMLInputElement;

        const share = html`<button class="explore-btn" onclick=${() => {
            navigator.clipboard.writeText(this.shareUrl());
            share.textContent = 'Copied!';
            setTimeout(() => { share.textContent = 'Copy share link'; }, 1500);
        }}>Copy share link</button>` as HTMLButtonElement;

        this.elUndoBtn = html`<button class="explore-btn explore-btn--icon" title="Undo (Cmd/Ctrl+Z)"
            onclick=${() => this.undo()}>↶</button>` as HTMLButtonElement;
        this.elRedoBtn = html`<button class="explore-btn explore-btn--icon" title="Redo (Cmd/Ctrl+Shift+Z)"
            onclick=${() => this.redo()}>↷</button>` as HTMLButtonElement;
        this.elToolbar.replaceChildren(
            this.titleInput,
            this.elUndoBtn, this.elRedoBtn, share);
    }

    private shareUrl(): string {
        const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(this.state))));
        return `${window.location.origin}${window.location.pathname}#s=${encoded}`;
    }

    // ---- tree --------------------------------------------------------------

    private buildTreeShell() {
        // Only chart widgets are addable here. Parameter widgets (Text Input,
        // Checkbox Group) render an input bound to a {name:String} query param that
        // only does anything when ANOTHER widget's query references it — standing
        // alone in Explore they affect nothing. Container widgets (Grid,
        // Collapsible Group) are not yet buildable in the flat tree. Both stay
        // registered/serializable so compiled dashboards and "Open in Explore"
        // round-trip them; they are just hidden from the add list (see docs UX note).
        const chartTypes = Object.keys(this.formModel?.widgets ?? {})
            .filter((type) => this.formModel!.widgets[type].category === 'chart');
        const sel = html`<select class="explore-input">${
            chartTypes.map((type) => html`<option value=${type}>${this.formModel!.widgets[type].title}</option>`)}</select>` as HTMLSelectElement;
        const add = html`<button class="explore-btn explore-btn--sm" onclick=${() => this.addWidget(sel.value)}>+ add</button>`;

        this.elTreeList = html`<ul class="explore-tree__list"></ul>` as HTMLElement;
        this.elTree.replaceChildren(
            html`<div class="explore-tree__add">${sel}${add}</div>`,
            this.elTreeList);
    }

    private renderTreeList(items: {id: string; type: string}[], sel: string | null) {
        this.elTreeList.replaceChildren(...items.map((w, i) => {
            const name = html`<span class="explore-tree__name"
                onclick=${() => { this.ui.selectedId = w.id; }}>${this.formModel?.widgets[w.type]?.title ?? w.type}</span>`;
            // Draggable row (replaces the ↑/↓ arrows): drag to reorder. Duplicate +
            // delete controls sit at the trailing edge.
            const li = html`<li draggable="true"
                class=${'explore-tree__item' + (w.id === sel ? ' is-selected' : '')}>
                <span class="explore-tree__grip" title="Drag to reorder">⠿</span>
                ${name}
                ${this.iconBtn('⧉', false, () => this.duplicateWidget(w.id))}
                ${this.iconBtn('×', false, () => this.deleteWidget(w.id))}
            </li>` as HTMLElement;
            this.wireTreeDnd(li, i);
            return li;
        }));
    }

    // Wire one tree row for drag-and-drop reordering. dragstart stashes the source
    // index; dragover marks the hovered row + allows the drop; drop moves the
    // widget before the target. Kept local + imperative (CSP forbids Alpine
    // expression handlers) — the state mutation flows through moveWidget, so the
    // tree/preview effects repaint from the reordered array.
    private wireTreeDnd(li: HTMLElement, index: number) {
        li.addEventListener('dragstart', (e: DragEvent) => {
            this.dragIndex = index;
            e.dataTransfer?.setData('text/plain', String(index));
            if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        });
        li.addEventListener('dragover', (e: DragEvent) => {
            e.preventDefault(); // required so drop fires
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            li.classList.add('is-drop-target');
        });
        li.addEventListener('dragleave', () => li.classList.remove('is-drop-target'));
        li.addEventListener('drop', (e: DragEvent) => {
            e.preventDefault();
            li.classList.remove('is-drop-target');
            if (this.dragIndex !== null && this.dragIndex !== index) this.moveWidget(this.dragIndex, index);
            this.dragIndex = null;
        });
        li.addEventListener('dragend', () => { this.dragIndex = null; });
    }

    private iconBtn(label: string, disabled: boolean, onClick: () => void): HTMLButtonElement {
        const b = html`<button class="explore-btn explore-btn--icon" onclick=${onClick}>${label}</button>` as HTMLButtonElement;
        b.disabled = disabled;
        return b;
    }

    private addWidget(type: string) {
        if (!type || !this.formModel?.widgets[type]) return;
        const w: WidgetState = {id: `w${this.idSeq++}`, type, props: deepClone(this.formModel.widgets[type].defaults)};
        this.state.widgets.push(w);
        this.ui.selectedId = w.id;
        this.pushHistory();
    }

    private deleteWidget(id: string) {
        this.state.widgets = this.state.widgets.filter((w) => w.id !== id);
        if (this.ui.selectedId === id) this.ui.selectedId = null;
        this.pushHistory();
    }

    // Move the widget at `from` to just before the widget currently at `to`
    // (drag-and-drop reorder). Splices the reactive array in place so the tree +
    // preview effects repaint without refetching (cards look up by id).
    private moveWidget(from: number, to: number) {
        const arr = this.state.widgets;
        if (from < 0 || from >= arr.length || to < 0 || to >= arr.length || from === to) return;
        const [item] = arr.splice(from, 1);
        arr.splice(to > from ? to - 1 : to, 0, item);
        this.pushHistory();
    }

    // Duplicate a widget: a deep copy of its props with a fresh id, inserted right
    // after the original and selected. Commits (build) so the new card renders.
    private duplicateWidget(id: string) {
        const arr = this.state.widgets;
        const i = arr.findIndex((w) => w.id === id);
        if (i < 0) return;
        const copy: WidgetState = {id: `w${this.idSeq++}`, type: arr[i].type, props: deepClone(raw(arr[i].props))};
        arr.splice(i + 1, 0, copy);
        this.ui.selectedId = copy.id;
        this.build();
    }

    // ---- undo / redo history ----------------------------------------------

    // Snapshot the current state onto the history stack (truncating any redo
    // tail). A no-op if the state is unchanged since the last snapshot, so
    // Build-with-no-edits or a settle-on-same-value never adds noise.
    private pushHistory() {
        const snap = deepClone(this.state);
        const head = this.history[this.histIndex];
        if (head && JSON.stringify(head) === JSON.stringify(snap)) return;
        this.history = this.history.slice(0, this.histIndex + 1);
        this.history.push(snap);
        this.histIndex = this.history.length - 1;
        this.updateHistoryButtons();
    }

    private undo() {
        if (this.histIndex <= 0) return;
        this.histIndex--;
        this.restore(this.history[this.histIndex]);
    }

    private redo() {
        if (this.histIndex >= this.history.length - 1) return;
        this.histIndex++;
        this.restore(this.history[this.histIndex]);
    }

    // Apply a history snapshot and re-render previews from it. Undo/redo ARE an
    // explicit commit, so they bump buildRev (previews re-query) and rebuild the
    // inspector (whose form is not prop-reactive, so it would otherwise show the
    // pre-undo values).
    private restore(snap: DashboardState) {
        this.applyState(deepClone(snap));
        if (this.ui.selectedId && !this.state.widgets.some((w) => w.id === this.ui.selectedId)) {
            this.ui.selectedId = null;
        }
        this.ui.buildRev++;
        this.scheduleInspector();
        this.updateHistoryButtons();
        this.refreshValidation();
    }

    private updateHistoryButtons() {
        if (this.elUndoBtn) this.elUndoBtn.disabled = this.histIndex <= 0;
        if (this.elRedoBtn) this.elRedoBtn.disabled = this.histIndex >= this.history.length - 1;
    }

    // ---- inspector ---------------------------------------------------------

    // Coalesce the effect's (possibly repeated) requests into one build that
    // runs OUTSIDE any active effect — so control reads of props do not become
    // dependencies of the inspector effect.
    private scheduleInspector() {
        if (this.inspectorScheduled) return;
        this.inspectorScheduled = true;
        queueMicrotask(() => { this.inspectorScheduled = false; this.buildInspector(); });
    }

    private buildInspector() {
        const insp = this.elInspector;
        insp.innerHTML = '';
        this.elInspectorValidation = null;
        const w = this.state.widgets.find((x) => x.id === this.ui.selectedId);
        if (!w) {
            insp.innerHTML = '<div class="explore-empty">Select a widget to edit its options.</div>';
            return;
        }
        const descriptor = this.formModel!.widgets[w.type];

        // Type switcher: change the widget's chart type in place, remapping the
        // existing field choices onto the new type's slots by role (see
        // switchType). Only chart types are offered (same filter as the add list).
        const chartTypes = Object.keys(this.formModel!.widgets)
            .filter((t) => this.formModel!.widgets[t].category === 'chart');
        const typeSel = html`<select class="explore-input explore-inspector__type"
            onchange=${() => this.switchType(w, typeSel.value)}>${
            chartTypes.map((t) => html`<option value=${t}>${this.formModel!.widgets[t].title}</option>`)}</select>` as HTMLSelectElement;
        typeSel.value = w.type;
        insp.appendChild(html`<div class="explore-inspector__title">${typeSel}</div>`);

        // Client-side validation panel: lists required-but-empty fields. Updated
        // live by the delegated input listener (wireInspectorInteractions) and on
        // build/undo — a purely local, understandable check (no server round-trip).
        this.elInspectorValidation = html`<div></div>` as HTMLElement;
        insp.appendChild(this.elInspectorValidation);

        const queryKey = descriptor.queryKey;
        // Controls write into w.props (the reactive proxy) — the per-widget
        // preview effect and the persist effect react. No onChange plumbing.
        const ctx: ControlCtx = {
            baseUrl: this.baseUrl,
            schema: this.schema,
            fieldKinds: this.formModel!.fieldKinds ?? [],
            getTable: () => {
                const q = queryKey ? w.props[queryKey] : null;
                return q && q.kind === 'table' ? q.table : null;
            },
        };
        const form = document.createElement('div');
        renderForm(form, descriptor, w.props, ctx);
        insp.appendChild(form);

        // Apply runs the query for the edits above (same as Enter / Cmd+Enter).
        // Placed at the foot of the property form — where the edits are — rather
        // than the global toolbar, so the "edit here → apply here" flow is local.
        insp.appendChild(html`<div class="explore-inspector__footer">
            <button class="explore-btn explore-btn--primary explore-inspector__apply"
                title="Run the query for these edits (Enter / Cmd+Enter)"
                onclick=${() => this.build()}>Apply <kbd class="explore-kbd">⏎ Enter</kbd></button>
        </div>`);
        this.refreshValidation();
    }

    // ---- type switching ----------------------------------------------------

    // Change a widget's chart type in place, carrying its configuration across.
    // Mutates props in the reactive proxy then commits (Build) so the preview
    // re-renders and the change lands on the undo history. The inspector effect
    // (which tracks w.type) rebuilds the form for the new type.
    private switchType(w: WidgetState, newType: string) {
        if (!newType || newType === w.type || !this.formModel?.widgets[newType]) return;
        const remapped = this.remapProps(w.type, newType, raw(w.props));
        w.type = newType;
        // Replace props contents in place (keep the same reactive proxy object so
        // the per-card preview effect and controls stay bound to it).
        for (const k of Object.keys(w.props)) delete w.props[k];
        Object.assign(w.props, remapped);
        this.build();
    }

    // Only top-level field slots (editor 'field'). Nested group fields are not
    // remapped — same scope as seedRequiredFields.
    private fieldSlots(type: string): FieldDescriptor[] {
        return (this.formModel!.widgets[type]?.fields ?? []).filter((f) => f.editor === 'field');
    }

    // Build the new type's props from the old widget's props:
    //  1. start from the new type's defaults,
    //  2. carry the query source (table / WHERE / raw SQL) verbatim,
    //  3. remap field slots POSITIONALLY within each role — the i-th old
    //     dimension fills the i-th new dimension slot, i-th measure → i-th
    //     measure — but only when the old value's kind is valid for the new slot
    //     (so an enum never lands in a time-bucket slot; the seeded default stays),
    //  4. copy like-named non-field options (title, height, margins, color, …).
    // This makes bar-vertical ⇄ bar-horizontal a lossless swap: the grouping
    // (categorical) field and the value (measure) field keep their meaning even
    // though the axes trade places.
    private remapProps(oldType: string, newType: string, oldProps: Record<string, any>): Record<string, any> {
        const oldDesc = this.formModel!.widgets[oldType];
        const newDesc = this.formModel!.widgets[newType];
        const fieldKinds = this.formModel!.fieldKinds ?? [];
        const newProps: Record<string, any> = deepClone(newDesc.defaults);

        // (2) query source verbatim.
        if (oldDesc.hasQuery && oldDesc.queryKey && newDesc.hasQuery && newDesc.queryKey
            && oldProps[oldDesc.queryKey] != null) {
            newProps[newDesc.queryKey] = deepClone(oldProps[oldDesc.queryKey]);
        }

        // (3) field slots, positional within role.
        const oldByRole: Record<string, any[]> = {};
        for (const f of this.fieldSlots(oldType)) {
            const v = oldProps[f.name];
            if (v && typeof v === 'object' && v.kind) (oldByRole[f.role ?? ''] ??= []).push(v);
        }
        const cursor: Record<string, number> = {};
        for (const f of this.fieldSlots(newType)) {
            const role = f.role ?? '';
            const i = cursor[role] ?? 0;
            cursor[role] = i + 1;
            const cand = oldByRole[role]?.[i];
            if (cand && kindsForSlot(f, fieldKinds).includes(cand.kind)) {
                newProps[f.name] = deepClone(cand);
            }
        }

        // (4) like-named scalar/composite options (not fields, not the query).
        for (const oldF of oldDesc.fields) {
            if (oldF.editor === 'field' || oldF.editor === 'children') continue;
            const nf = newDesc.fields.find((x) => x.name === oldF.name && x.editor === oldF.editor);
            if (nf && oldProps[oldF.name] !== undefined) newProps[oldF.name] = deepClone(oldProps[oldF.name]);
        }

        return newProps;
    }

    // ---- client-side validation -------------------------------------------

    private widgetById(id: string | null): WidgetState | undefined {
        if (!id) return undefined;
        return (raw(this.state.widgets) as WidgetState[]).find((w) => w.id === id);
    }

    // validateWidget returns human-readable messages for required-but-empty
    // fields. Deliberately shallow and local: table chosen, raw SQL non-empty +
    // contains {{DASHICA_FILTERS}}, and each required field picker has a
    // column/expression. It never talks to the server — the query itself is the
    // authority on SQL correctness, surfaced on the card after Build.
    private validateWidget(w: WidgetState): string[] {
        const d = this.formModel?.widgets[w.type];
        if (!d) return [];
        const props = raw(w.props);
        const issues: string[] = [];
        const nonEmpty = (v: any) => typeof v === 'string' && v.trim() !== '';

        if (d.hasQuery && d.queryKey) {
            const q = props[d.queryKey];
            if (!q || typeof q !== 'object') issues.push('Configure the query source.');
            else if (q.kind === 'table' && !nonEmpty(q.table)) issues.push('Pick a table.');
            else if (q.kind === 'raw') {
                if (!nonEmpty(q.sql)) issues.push('Raw SQL is empty.');
                else if (!q.sql.includes('{{DASHICA_FILTERS}}')) issues.push('Raw SQL must contain {{DASHICA_FILTERS}}.');
            }
        }
        for (const f of d.fields) {
            if (f.editor !== 'field' || !f.required) continue;
            const v = props[f.name];
            const label = humanize(f.name);
            if (!v || typeof v !== 'object' || !v.kind) issues.push(`${label} is required.`);
            else if (v.kind === 'autoBucket' && !nonEmpty(v.column)) issues.push(`${label}: choose a column.`);
            else if ((v.kind === 'enum' || v.kind === 'expr') && !nonEmpty(v.definition)) issues.push(`${label}: choose a column or expression.`);
        }
        return issues;
    }

    // Refresh the inspector's validation panel for the selected widget. Cheap and
    // imperative — rewrites only its own box, so it never disturbs form focus.
    private refreshValidation() {
        const box = this.elInspectorValidation;
        if (!box) return;
        const w = this.widgetById(this.ui.selectedId);
        const issues = w ? this.validateWidget(w) : [];
        if (issues.length === 0) { box.replaceChildren(); return; }
        box.replaceChildren(html`<div class="explore-validation">
            <div class="explore-validation__title">Complete before building:</div>
            <ul class="explore-validation__list">${issues.map((m) => html`<li>${m}</li>`)}</ul>
        </div>`);
    }

    // ---- preview (reconcile + one effect per card) -------------------------

    private reconcilePreviews(widgets: WidgetState[], ids: string[], sel: string | null) {
        const pv = this.elPreview;

        for (const id of Object.keys(this.previews)) {
            if (!ids.includes(id)) this.teardownPreview(id);
        }

        if (widgets.length === 0) {
            if (!pv.querySelector('.explore-empty')) {
                pv.replaceChildren(html`<div class="explore-empty">Add a widget to start building.</div>`);
            }
            return;
        }
        pv.querySelectorAll('.explore-empty').forEach((n) => n.remove());

        for (const w of widgets) {
            let entry = this.previews[w.id];
            if (!entry) entry = this.mountWidgetPreview(w.id);
            entry.card.classList.toggle('is-selected', w.id === sel);
            pv.appendChild(entry.card); // re-append = reorder, keeps the node (no refetch)
        }

        // When the selection *changes*, scroll its preview card into the middle of
        // the preview pane — so picking a widget in the tree reveals it. Guarded on
        // a change so structural repaints (add/delete/reorder) don't re-scroll.
        if (sel && sel !== this.lastScrolledSel && this.previews[sel]) {
            this.previews[sel].card.scrollIntoView({block: 'center', behavior: 'smooth'});
        }
        this.lastScrolledSel = sel;
    }

    private mountWidgetPreview(id: string): PreviewEntry {
        const body = html`<div class="explore-card__body"></div>` as HTMLElement;
        // No overlay controls on the card — duplicate/delete live in the tree row
        // (shown on hover). The card is just a click target to select.
        const card = html`<div class="explore-card" onclick=${() => { this.ui.selectedId = id; }}>${body}</div>` as HTMLElement;

        const entry: PreviewEntry = {card, controller: mountPreview(body, this.baseUrl), eff: null, lastRendered: null};
        this.previews[id] = entry;

        // Per-card effect (guardrail 5): its ONLY reactive dep is ui.buildRev, so
        // it re-renders on an explicit Build (or undo/redo bump) — never on a prop
        // edit. The widget + its props are read untracked inside renderCard, which
        // gates on client validation before firing a query. First run at mount
        // paints the loaded/committed state (or a "pick a table" hint for a fresh
        // widget) without waiting for a Build.
        entry.eff = Alpine.effect(() => {
            void this.ui.buildRev;   // the sole dependency
            this.renderCard(entry, id);
        });
        return entry;
    }

    // Render (or gate) one card from the CURRENT widget state, read untracked.
    // Not ready → a friendly hint, no query. Ready + unchanged since last render
    // → skip (so a Build that touched other widgets doesn't refetch this one).
    private renderCard(entry: PreviewEntry, id: string) {
        const w = this.widgetById(id);
        if (!w) return;
        const issues = this.validateWidget(w);
        if (issues.length > 0) {
            entry.controller.message(issues[0]);
            entry.lastRendered = null;
            return;
        }
        const env = this.cleanEnvelope(w);
        const json = JSON.stringify(env);
        if (json === entry.lastRendered) return;
        entry.lastRendered = json;
        entry.controller.render(env);
    }

    // Build the wire envelope, dropping empty/whitespace WHERE clauses so a
    // half-typed or just-added blank row never serializes into `WHERE () AND …`.
    // Client-side only — kept simple and visible rather than papered over on the
    // server.
    private cleanEnvelope(w: WidgetState): WidgetEnvelope {
        const props = deepClone(raw(w.props));
        const qk = this.formModel?.widgets[w.type]?.queryKey;
        const q = qk ? props[qk] : null;
        if (q && q.kind === 'table' && Array.isArray(q.where)) {
            q.where = q.where.filter((c: any) => typeof c === 'string' && c.trim() !== '');
        }
        return {type: w.type, props};
    }

    private teardownPreview(id: string) {
        const e = this.previews[id];
        if (!e) return;
        if (e.eff) Alpine.release(e.eff);
        e.controller.destroy();
        e.card.remove();
        delete this.previews[id];
    }

    // ---- drawer (Go code / JSON / SQL) ------------------------------------

    private buildDrawerShell() {
        // Drag handle along the drawer's top edge → resize its height.
        const resize = html`<div class="explore-drawer__resize" title="Drag to resize"></div>` as HTMLElement;
        this.wireDrawerResize(resize);

        const tabDefs: [DrawerTab, string][] = [['data', 'Data'], ['gocode', 'Go code'], ['json', 'JSON']];
        const tabs = tabDefs.map(([key, label]) =>
            // Clicking the active tab while expanded collapses; otherwise select + expand.
            html`<button class="explore-tab" data-tab=${key} onclick=${() => {
                if (this.ui.drawerTab === key && !this.ui.drawerCollapsed) { this.ui.drawerCollapsed = true; return; }
                this.ui.drawerTab = key;
                this.ui.drawerCollapsed = false;
            }}>${label}</button>`);

        this.elDrawerCollapse = html`<button class="explore-btn explore-btn--sm explore-drawer__collapse"
            onclick=${() => { this.ui.drawerCollapsed = !this.ui.drawerCollapsed; }}></button>` as HTMLButtonElement;

        this.elDrawerTabs = html`<div class="explore-drawer__tabs">
            ${tabs}
            <div class="explore-drawer__tabs-spacer"></div>
            ${this.elDrawerCollapse}
        </div>` as HTMLElement;

        this.elDrawerContent = html`<div class="explore-drawer__content"></div>` as HTMLElement;

        this.elDrawer.replaceChildren(resize, this.elDrawerTabs, this.elDrawerContent);
    }

    private updateDrawerTabs(active: DrawerTab, collapsed: boolean) {
        this.elDrawerTabs.querySelectorAll<HTMLElement>('.explore-tab').forEach((b) => {
            b.classList.toggle('is-active', b.dataset.tab === active && !collapsed);
        });
        this.elDrawer.classList.toggle('is-collapsed', collapsed);
        this.elDrawerCollapse.textContent = collapsed ? '▲' : '▼';
        this.elDrawerCollapse.title = collapsed ? 'Expand drawer' : 'Collapse drawer';
    }

    // Pointer-drag the top edge to resize the drawer height (clamped). Height is
    // set inline on the drawer element, which sizes the grid's auto "drawer" row.
    private wireDrawerResize(handle: HTMLElement) {
        handle.addEventListener('pointerdown', (down: PointerEvent) => {
            if (this.ui.drawerCollapsed) return;
            down.preventDefault();
            const startY = down.clientY;
            const startH = this.elDrawer.getBoundingClientRect().height;
            handle.setPointerCapture(down.pointerId);
            const onMove = (move: PointerEvent) => {
                const h = startH + (startY - move.clientY); // drag up → taller
                const max = window.innerHeight * 0.8;
                this.elDrawer.style.height = `${Math.max(90, Math.min(max, h))}px`;
            };
            const onUp = () => {
                handle.removeEventListener('pointermove', onMove);
                handle.removeEventListener('pointerup', onUp);
            };
            handle.addEventListener('pointermove', onMove);
            handle.addEventListener('pointerup', onUp);
        });
    }

    // The preview strip's "filters" button toggles the SQL-filter textarea
    // (server-rendered inside the searchBar-scoped controls). Kept out of Alpine
    // to avoid CSP expression limits — plain DOM toggle of the [hidden] panel.
    private wireFilterToggle() {
        const btn = this.root.querySelector<HTMLElement>('[data-explore="filters-toggle"]');
        const panel = this.root.querySelector<HTMLElement>('[data-explore="filters"]');
        if (!btn || !panel) return;
        btn.addEventListener('click', () => {
            const show = panel.hasAttribute('hidden');
            panel.toggleAttribute('hidden', !show);
            btn.classList.toggle('is-active', show);
        });
    }

    private buildJsonTab(content: HTMLElement) {
        const status = html`<div class="explore-json__status"></div>` as HTMLElement;
        const ta = html`<textarea class="explore-input explore-textarea explore-json" spellcheck="false"
            oninput=${() => {
                try {
                    const ns = validateState(JSON.parse(ta.value));
                    this.applyState(ns);
                    status.textContent = 'valid — applied';
                    status.className = 'explore-json__status is-ok';
                } catch (e: any) {
                    status.textContent = e.message;
                    status.className = 'explore-json__status is-err';
                }
            }}></textarea>` as HTMLTextAreaElement;
        content.append(ta, status);
        this.jsonTextarea = ta;
        // Seed the initial value now; the json-sync effect keeps it fresh after.
        // Read via raw(): this runs inside the drawer effect, and tracking state
        // here would rebuild the textarea on every keystroke (defocus).
        ta.value = JSON.stringify(raw(this.state), null, 2);
    }

    private buildGocodeTab(content: HTMLElement) {
        // Go code generation is Phase 4 (POST /api/gocode). Until then, show the
        // graduate-to-code path as pending rather than fabricating source.
        content.innerHTML = '<div class="explore-empty">Go code generation ships in Phase 4 ' +
            '(the <code>/api/gocode</code> endpoint). The JSON tab is the source of truth meanwhile.</div>';
    }

    // Data tab: makes the selected widget's data model visible (docs UX plan
    // (2)) — the table's columns (name / type / comment / class, straight from
    // the already-loaded /api/schema, no new endpoint) beside live sample rows.
    // The sample is a *synthetic* table widget pushed through the exact same
    // preview/render + preview/query path as any preview, so it respects the
    // current time range and filters by construction and needs zero new backend.
    // SQL / EXPLAIN is not a drawer tab — every preview chart's own wrench button
    // opens the standard debug drawer.
    //
    // This runs inside the drawer effect; it reads only the selected widget's
    // query *table* reactively (via getWidgetTable), so it refreshes when the
    // table changes but not on unrelated prop edits.
    private buildDataTab(content: HTMLElement, selectedId: string | null) {
        const w = selectedId ? this.state.widgets.find((x) => x.id === selectedId) : null;
        if (!w) {
            content.innerHTML = '<div class="explore-empty">Select a widget to inspect its data.</div>';
            return;
        }
        const table = this.getWidgetTable(w);
        if (!table) {
            content.innerHTML = '<div class="explore-empty">This widget has no table source ' +
                '(raw SQL or none), so there is no schema to show. Pick a table in the inspector.</div>';
            return;
        }

        // columns pane
        const cols: Column[] = this.schema?.columns[table] ?? [];
        const colsPane = html`<div class="explore-data__cols">
            ${this.dataPaneTitle(`Columns · ${table}`)}
            ${cols.length === 0 ? this.emptyNote('No columns found for this table.') : cols.map((c) => this.columnRow(table, c))}
        </div>`;

        // sample rows pane — synthetic table widget through the preview path.
        const sampleBody = html`<div class="explore-data__sample-body"></div>` as HTMLElement;
        const samplePane = html`<div class="explore-data__sample">
            ${this.dataPaneTitle('Sample rows')}
            ${sampleBody}
        </div>`;

        content.appendChild(html`<div class="explore-data">${colsPane}${samplePane}</div>`);

        this.dataPreview = mountPreview(sampleBody, this.baseUrl);
        // Plain SELECT * over the table. ClickHouse cannot serialize its JSON /
        // Object / Dynamic / Variant columns to Arrow, but that concern is now
        // owned by the transport layer (lib/clickhouse ensureArrowCompatible casts
        // exactly those columns to String), so the editor stays DB-blind here.
        const envelope: WidgetEnvelope = {type: 'table', props: {sql: {kind: 'table', table}, limit: 50}};
        this.dataPreview.render(envelope);
    }

    private dataPaneTitle(text: string): HTMLElement {
        return html`<div class="explore-section-title">${text}</div>` as HTMLElement;
    }

    private emptyNote(text: string): HTMLElement {
        return html`<div class="explore-field__help">${text}</div>` as HTMLElement;
    }

    // Resolve the selected widget's base-query table (reactively reads the query
    // kind + table, nothing else), or null when it is not a plain table source.
    private getWidgetTable(w: WidgetState): string | null {
        const key = this.formModel?.widgets[w.type]?.queryKey;
        if (!key) return null;
        const q = w.props[key];
        return q && q.kind === 'table' && q.table ? q.table : null;
    }

    // One column row: class badge + name + type + comment. Categorical columns
    // get a "values" toggle that fetches the top distinct values (/api/values) —
    // the affordance is class-appropriate: sampling distinct values is
    // meaningless/expensive on continuous columns, so it is offered only for
    // categorical ones (docs UX plan (3)).
    private columnRow(table: string, c: Column): HTMLElement {
        const badge = classBadge(c.class);
        const head = html`<div class="explore-data__col-head">
            ${badge ? html`<span class="explore-badge" title=${c.class ?? ''}>${badge}</span>` : ''}
            <span class="explore-data__col-name">${c.name}</span>
            <span class="explore-data__col-type">${c.type}</span>
        </div>` as HTMLElement;

        const parts: (Node | string)[] = [head];
        if (c.class === 'categorical') {
            const valuesBox = html`<div class="explore-data__values" hidden></div>` as HTMLElement;
            let loaded = false;
            head.appendChild(html`<button type="button" class="explore-btn explore-btn--sm explore-data__values-btn"
                onclick=${() => {
                    valuesBox.hidden = !valuesBox.hidden;
                    if (!valuesBox.hidden && !loaded) { loaded = true; this.loadColumnValues(table, c.name, valuesBox); }
                }}>values</button>`);
            parts.push(valuesBox);
        }
        if (c.comment) parts.push(html`<div class="explore-data__col-comment">${c.comment}</div>`);

        return html`<div class="explore-data__col">${parts}</div>` as HTMLElement;
    }

    private loadColumnValues(table: string, column: string, box: HTMLElement) {
        box.textContent = 'loading…';
        const url = `${this.baseUrl}/api/values?table=${encodeURIComponent(table)}&column=${encodeURIComponent(column)}`;
        fetch(url)
            .then((r) => r.ok ? r.json() : r.text().then((t) => { throw new Error(t); }))
            .then((rows: {value: string; count: number}[]) => {
                if (!rows || rows.length === 0) { box.replaceChildren(this.emptyNote('No values.')); return; }
                box.replaceChildren(...rows.map((rv) => html`<div class="explore-data__value">
                    <span class="explore-data__value-val">${rv.value === '' ? '(empty)' : rv.value}</span>
                    <span class="explore-data__value-count">${String(rv.count)}</span>
                </div>`));
            })
            .catch((e) => { box.textContent = ''; box.appendChild(this.emptyNote(`Error: ${e.message}`)); });
    }
}

// Alpine boundary: register the component, construct the plain Editor, start it.
// The editor root carries [data-filter-scope]; we create its single URL-syncing
// filter scope here (before the preview charts mount, since Alpine inits parents
// first) so the preview strip's SQL filter + the global $store.timeState drive
// the preview charts automatically — the editor needs no filter effect.
export default () => ({
    init() {
        createFilterScope(this.$el, { syncUrl: true });
        const editor = new Editor(this.$el, this.$el.dataset.baseUrl || '');
        editor.start();
    },
});
