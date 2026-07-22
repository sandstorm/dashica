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
import {AddableType, classBadge, Column, ControlCtx, FieldDescriptor, FieldKind, humanize, kindsForSlot, SchemaResponse} from "./controls";
import {renderForm, WidgetDescriptor} from "./formRenderer";
import {mountPreview, PreviewController, WidgetEnvelope} from "./preview";
import {createFilterScope} from "../store";
import {initDock, resetDock, wireLazyDebugDrawer, type DockviewApi} from "../components/dock";

// localStorage key for the Explore editor's dockview layout (§4.2).
const EXPLORE_DOCK_KEY = 'dashica.explore.dock';

interface WidgetState { id: string; type: string; props: Record<string, any>; }
interface DashboardState { title: string; layout: string; widgets: WidgetState[]; }
interface WidgetFormModel extends WidgetDescriptor { defaults: Record<string, any>; }
interface FormModel { widgets: Record<string, WidgetFormModel>; layouts: string[]; fieldKinds: FieldKind[]; }

type DrawerTab = 'data' | 'gocode' | 'json';
// buildRev is the "commit" counter: previews query only when it changes (an
// explicit Build), never on every keystroke — see the preview effect below.
// buildRev is the preview "commit" counter: previews re-query only when it
// changes (an explicit Build) — see the preview effect below.
interface UiState { selectedId: string | null; drawerTab: DrawerTab; buildRev: number; }

// A child widget lives inside its container's props as a bare {type, props}
// envelope (no id) — grid areas (a map keyed by area name) and collapsibleGroup
// widgets (a list). WidgetNode is the common shape of anything editable: a
// top-level WidgetState or a child envelope.
interface WidgetNode { type: string; props: Record<string, any>; }

// NodeRef resolves a selection path to the addressed node plus enough context to
// mutate it in place. `topId` is the top-level ancestor's id — the unit of
// preview card, so selecting a child still highlights/scrolls its container.
interface NodeRef {
    node: WidgetNode;
    topId: string;
    // The container this node sits in (null for a top-level widget), so delete
    // can splice/unset it without re-walking the path.
    parent:
        | { shape: 'list'; arr: WidgetNode[]; index: number }
        | { shape: 'map'; map: Record<string, WidgetNode>; key: string }
        | null;
}

// One rendered tree row: a selectable node plus its recursively-built children.
interface TreeNode {
    path: string;
    type: string;
    label: string;
    depth: number;
    // True when this widget has a childrenList/childrenMap field — a valid
    // drop-into target and rendered with a container affordance.
    isContainer: boolean;
    // Reorder affordances (list children only); top-level uses drag instead.
    reorder?: { up: () => void; down: () => void };
    remove?: () => void;
    children: TreeNode[];
}

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
    // The three drawer panels (Data / Go code / JSON) are dockview panels now;
    // each has its own content element, and the drawer effect builds into the
    // active one (dockview owns the tab bar and which panel is visible).
    private drawerPanels: Record<DrawerTab, HTMLElement>;
    private titleInput!: HTMLInputElement;
    private elTreeList!: HTMLElement;
    // The tree's add-widget type picker; also drives the per-container "+" button.
    private treeAddSelect!: HTMLSelectElement;
    private jsonTextarea: HTMLTextAreaElement | null = null;
    // Go-code tab: the <pre> the generated source is written into (null when the
    // tab is not built), an abort controller so a stale generate response can't
    // overwrite a newer one, and the last JSON we generated from (skip refetch
    // when unchanged).
    private gocodePre: HTMLElement | null = null;
    private gocodeAbort: AbortController | null = null;
    private gocodeLastJson: string | null = null;
    private elUndoBtn!: HTMLButtonElement;
    private elRedoBtn!: HTMLButtonElement;
    private elInspectorValidation: HTMLElement | null = null;

    // Undo/redo history: snapshots of the full dashboard state. A snapshot is
    // pushed on every discrete action (add/delete/move) and on Build (which
    // commits the edits typed since the last snapshot). Cmd/Ctrl+Z / Y step it.
    private history: DashboardState[] = [];
    private histIndex = -1;

    private inspectorScheduled = false;

    // Selection path of the row being dragged in the tree (null when not
    // dragging). Drives both top-level reorder and drop-into-a-container.
    private dragPath: string | null = null;
    // The row element currently highlighted as the drop target (delegated DnD).
    private dropTargetEl: HTMLElement | null = null;

    // Last selection we scrolled the preview to — so we only auto-scroll on an
    // actual selection change, not on every structural repaint.
    private lastScrolledSel: string | null = null;

    // dockApi is the assembled Explore dock (built before Alpine.start by
    // initExploreDock). The mount elements below were MOVED out of the staging
    // block into dock panels, but remain descendants of `root`, so the same
    // querySelectors still resolve them.
    constructor(private root: HTMLElement, private baseUrl: string, private dockApi: DockviewApi | null) {
        this.elToolbar = root.querySelector('[data-explore="toolbar"]')!;
        this.elTree = root.querySelector('[data-explore="tree"]')!;
        this.elPreview = root.querySelector('[data-explore="preview"]')!;
        this.elInspector = root.querySelector('[data-explore="inspector"]')!;
        this.drawerPanels = {
            data: root.querySelector('[data-explore="drawer-data"]')!,
            gocode: root.querySelector('[data-explore="drawer-gocode"]')!,
            json: root.querySelector('[data-explore="drawer-json"]')!,
        };
    }

    async start() {
        this.ui = Alpine.reactive({selectedId: null, drawerTab: 'data', buildRev: 0} as UiState);
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
        this.wireDrawerTabs();
        this.wireKeyboard();
        this.wireInspectorInteractions();
        this.wireEffects();
        this.updateHistoryButtons();
    }

    // Mirror the dock's active drawer panel into ui.drawerTab so the drawer
    // effect rebuilds the right content when the user clicks a dockview tab.
    // (Preview / tree / inspector activations are ignored — not drawer tabs.)
    private wireDrawerTabs() {
        if (!this.dockApi) return;
        const byId: Record<string, DrawerTab> = {
            'drawer-data': 'data', 'drawer-gocode': 'gocode', 'drawer-json': 'json',
        };
        this.dockApi.onDidActivePanelChange((e) => {
            const tab = e.panel ? byId[e.panel.id] : undefined;
            if (tab) this.ui.drawerTab = tab;
        });
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

    // ---- nested-widget addressing -----------------------------------------

    // The container fields of a widget type (childrenList / childrenMap), in
    // struct order — the slots that hold nested widgets.
    private containerFields(type: string): { name: string; shape: 'list' | 'map' }[] {
        return (this.formModel?.widgets[type]?.fields ?? [])
            .filter((f) => f.editor === 'childrenList' || f.editor === 'childrenMap')
            .map((f) => ({ name: f.name, shape: f.editor === 'childrenMap' ? 'map' : 'list' }));
    }

    private containerFieldShape(type: string, fieldName: string): 'list' | 'map' | null {
        const f = this.formModel?.widgets[type]?.fields.find((x) => x.name === fieldName);
        if (!f) return null;
        return f.editor === 'childrenMap' ? 'map' : f.editor === 'childrenList' ? 'list' : null;
    }

    private topIdOf(sel: string | null): string | null {
        return sel ? sel.split('/')[0] : null;
    }

    // Resolve a selection path ("w3", "w3/areas/main", "w3/widgets/0/…") to the
    // addressed node and its parent container. Reads only structural bits (types
    // + container membership) so, inside an effect, editing a scalar prop of a
    // node never invalidates a resolve. Returns null for a stale/invalid path.
    private resolveNode(sel: string | null): NodeRef | null {
        if (!sel) return null;
        const parts = sel.split('/');
        const top = this.state.widgets.find((w) => w.id === parts[0]);
        if (!top) return null;
        let node: WidgetNode = top;
        let parent: NodeRef['parent'] = null;
        for (let i = 1; i < parts.length; i += 2) {
            const fieldName = parts[i];
            const key = parts[i + 1];
            if (key === undefined) return null;
            const shape = this.containerFieldShape(node.type, fieldName);
            const container = node.props[fieldName];
            if (shape === 'list' && Array.isArray(container)) {
                const index = parseInt(key, 10);
                const child = container[index];
                if (!child) return null;
                parent = { shape: 'list', arr: container, index };
                node = child;
            } else if (shape === 'map' && container && typeof container === 'object' && !Array.isArray(container)) {
                const child = container[key];
                if (!child) return null;
                parent = { shape: 'map', map: container, key };
                node = child;
            } else {
                return null;
            }
        }
        return { node, topId: top.id, parent };
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

        // tree: follows the (recursive) widget structure + selection. Building
        // the model reads types + container membership at every level, so it
        // repaints on add/remove/reorder anywhere in the tree, but NOT on a
        // scalar prop edit (those values are never read here).
        this.effects.push(Alpine.effect(() => {
            const model = this.buildTreeModel(); // structural dep (recursive reads)
            const sel = this.ui.selectedId;      // selection dep
            this.renderTreeNodes(model, sel);
        }));

        // inspector: depends ONLY on (selectedId, resolved node.type). The actual
        // form build is deferred to a microtask so control reads of props are
        // untracked (guardrail 1 — no defocus).
        this.effects.push(Alpine.effect(() => {
            const id = this.ui.selectedId;
            const ref = this.resolveNode(id);
            void (ref ? ref.node.type : null); // track type; ignore the value here
            this.scheduleInspector();
        }));

        // preview reconcile: create/destroy/reorder cards + selection outline.
        this.effects.push(Alpine.effect(() => {
            const widgets = this.state.widgets;
            const ids = widgets.map((w) => w.id); // structural dep
            const sel = this.ui.selectedId;        // selection dep
            this.reconcilePreviews(widgets, ids, sel);
        }));

        // drawer content follows the active tab. dockview owns the tab bar and
        // which panel is visible; we build content only into the active panel
        // (matching the old single-content behaviour — inactive tabs stay empty
        // until activated). The Data tab is selection-aware (reads selectedId
        // only in its own branch, so json/gocode don't rebuild on selection).
        this.effects.push(Alpine.effect(() => {
            const tab = this.ui.drawerTab;
            if (this.dataPreview) { this.dataPreview.destroy(); this.dataPreview = null; }
            this.drawerPanels.data.innerHTML = '';
            this.drawerPanels.gocode.innerHTML = '';
            this.drawerPanels.json.innerHTML = '';
            this.jsonTextarea = null;
            this.gocodePre = null;
            this.gocodeLastJson = null;
            if (this.gocodeAbort) { this.gocodeAbort.abort(); this.gocodeAbort = null; }
            const content = this.drawerPanels[tab];
            if (tab === 'json') this.buildJsonTab(content);
            else if (tab === 'gocode') this.buildGocodeTab(content);
            else this.buildDataTab(content, this.ui.selectedId); // data: selection dep
        }));

        // json live sync: the textarea reflects state when the json tab is open
        // and unfocused — this is what fixes stale JSON-tab content for free.
        this.effects.push(Alpine.effect(() => {
            const json = JSON.stringify(this.state, null, 2); // deep dep on state
            const ta = this.jsonTextarea;
            if (this.ui.drawerTab === 'json' && ta && document.activeElement !== ta) ta.value = json;
        }));

        // Go-code live sync: while the Go code tab is open, (re)generate from the
        // server whenever the state changes. Debounced, and skipped when the state
        // is unchanged since the last generate, so it POSTs at most once per edit
        // burst — the same "live but not per-keystroke" feel as the JSON tab.
        this.effects.push(Alpine.effect(() => {
            const json = JSON.stringify(this.state); // deep dep on state
            if (this.ui.drawerTab === 'gocode' && this.gocodePre) this.scheduleGocode(json);
        }));
    }

    // Debounced Go-code generation. Kept as an instance field so the debounce
    // timer is shared across calls (a per-call debounce would never coalesce).
    private scheduleGocode = debounce((json: string) => this.fetchGocode(json), 400);

    // fetchGocode POSTs the dashboard state to /api/gocode and writes the returned
    // Go source into the tab's <pre>. Aborts any in-flight request so a slow older
    // response cannot clobber a newer one.
    private fetchGocode(json: string) {
        if (!this.gocodePre || json === this.gocodeLastJson) return;
        this.gocodeLastJson = json;
        if (this.gocodeAbort) this.gocodeAbort.abort();
        this.gocodeAbort = new AbortController();
        const signal = this.gocodeAbort.signal;
        const pre = this.gocodePre;

        fetch(`${this.baseUrl}/api/gocode`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: json,
            signal,
        })
            .then((r) => r.ok ? r.text() : r.text().then((t) => { throw new Error(t); }))
            .then((src) => { if (!signal.aborted) { pre.textContent = src; pre.classList.remove('is-err'); } })
            .catch((e) => {
                if (signal.aborted || e.name === 'AbortError') return;
                pre.textContent = e.message; // textContent, never innerHTML — no injection
                pre.classList.add('is-err');
            });
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

        // Reset the dockview pane arrangement back to the default (drops the saved
        // layout in localStorage and reloads so buildDefaultLayout runs). Also the
        // way to bring the tree back after closing it. Panel CONTENT (the
        // dashboard) is untouched — only geometry resets.
        const resetLayout = html`<button class="explore-btn" title="Reset pane layout"
            onclick=${() => resetDock(EXPLORE_DOCK_KEY)}>Reset layout</button>` as HTMLButtonElement;

        this.elToolbar.replaceChildren(
            this.titleInput,
            this.elUndoBtn, this.elRedoBtn, share, resetLayout);
    }

    private shareUrl(): string {
        const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(this.state))));
        return `${window.location.origin}${window.location.pathname}#s=${encoded}`;
    }

    // ---- tree --------------------------------------------------------------

    private buildTreeShell() {
        // Addable at top level: chart widgets AND container widgets (grid,
        // collapsibleGroup) — a container is the entry point for nesting. The
        // same type <select> also feeds the per-container "+" add-child button in
        // the tree rows (see appendTreeRows). Parameter widgets (Text Input,
        // Checkbox Group) stay out: they render a {name:String} query param that
        // only does anything when ANOTHER widget's query references it, so alone
        // in Explore they affect nothing. They stay registered/serializable so
        // compiled dashboards and "Open in Explore" round-trip them.
        const addableTypes = this.addableTypes();
        this.treeAddSelect = html`<select class="explore-input">${
            addableTypes.map((t) => html`<option value=${t.type}>${t.title}</option>`)}</select>` as HTMLSelectElement;
        const add = html`<button class="explore-btn explore-btn--sm" onclick=${() => this.addWidget(this.treeAddSelect.value)}>+ add</button>`;

        this.elTreeList = html`<ul class="explore-tree__list"></ul>` as HTMLElement;
        this.elTree.replaceChildren(
            html`<div class="explore-tree__add">${this.treeAddSelect}${add}</div>`,
            this.elTreeList);
        this.wireTreeDnd();
    }

    // Add a child of the type currently chosen in the tree's add <select> into
    // the container at containerPath. This is the tree's "+" affordance — the one
    // place to grow a container besides dragging an existing widget in.
    private addChildOfSelectedType(containerPath: string) {
        const ref = this.resolveNode(containerPath);
        if (!ref) return;
        const cf = this.containerFields(ref.node.type)[0];
        const type = this.treeAddSelect?.value;
        if (!cf || !type) return;
        this.addChild(containerPath, cf.name, cf.shape, type);
    }

    // Widget types that can be added (top level or as a child): chart + container
    // widgets, with display titles, in a stable order.
    private addableTypes(): AddableType[] {
        return Object.keys(this.formModel?.widgets ?? {})
            .filter((type) => {
                const c = this.formModel!.widgets[type].category;
                return c === 'chart' || c === 'container';
            })
            .map((type) => ({ type, title: this.formModel!.widgets[type].title }));
    }

    // ---- tree model (recursive) -------------------------------------------

    // Build the tree as a nested model rooted at the top-level widgets. Walking
    // it reads each node's type + its container fields (childrenList/childrenMap)
    // — establishing the structural reactive deps for the tree effect. The
    // reorder/remove closures capture the mutation site so the row handlers are
    // trivial. Called only inside the tree effect and buildTreeModel is pure over
    // the current state.
    private buildTreeModel(): TreeNode[] {
        return this.state.widgets.map((w) => this.treeNode(w, w.id, 0));
    }

    private treeNode(node: WidgetNode, path: string, depth: number): TreeNode {
        const label = this.formModel?.widgets[node.type]?.title ?? node.type;
        const containerFields = this.containerFields(node.type);
        const children: TreeNode[] = [];
        for (const cf of containerFields) {
            const container = node.props[cf.name];
            if (cf.shape === 'list' && Array.isArray(container)) {
                container.forEach((child: WidgetNode, i: number) => {
                    const cn = this.treeNode(child, `${path}/${cf.name}/${i}`, depth + 1);
                    cn.reorder = {
                        up: () => this.moveChild(path, cf.name, i, -1),
                        down: () => this.moveChild(path, cf.name, i, +1),
                    };
                    cn.remove = () => this.removeChild(path, cf.name, 'list', String(i));
                    children.push(cn);
                });
            } else if (cf.shape === 'map' && container && typeof container === 'object' && !Array.isArray(container)) {
                for (const key of Object.keys(container)) {
                    const cn = this.treeNode(container[key], `${path}/${cf.name}/${key}`, depth + 1);
                    cn.label = `${key} · ${cn.label}`;
                    cn.remove = () => this.removeChild(path, cf.name, 'map', key);
                    children.push(cn);
                }
            }
        }
        return { path, type: node.type, label, depth, isContainer: containerFields.length > 0, children };
    }

    // Render the recursive tree model as a flat <li> list (children indented by
    // depth). Top-level rows are drag-reorderable + duplicable; child rows carry
    // their own ↑/↓ (list) and × from the model's captured closures.
    private renderTreeNodes(model: TreeNode[], sel: string | null) {
        const lis: HTMLElement[] = [];
        model.forEach((n) => this.appendTreeRows(n, sel, lis));
        this.elTreeList.replaceChildren(...lis);
    }

    private appendTreeRows(n: TreeNode, sel: string | null, out: HTMLElement[]) {
        const isTop = n.depth === 0;
        const name = html`<span class="explore-tree__name"
            onclick=${() => { this.ui.selectedId = n.path; }}>${n.label}</span>`;

        const trailing: (Node | string)[] = [];
        if (n.reorder) {
            trailing.push(this.iconBtn('↑', false, n.reorder.up));
            trailing.push(this.iconBtn('↓', false, n.reorder.down));
        }
        // Container rows: "+" adds a child of the type chosen in the tree's add
        // picker (the tree is the only place nested widgets are managed now).
        if (n.isContainer) trailing.push(this.iconBtn('+', false, () => this.addChildOfSelectedType(n.path)));
        if (isTop) trailing.push(this.iconBtn('⧉', false, () => this.duplicateWidget(n.path)));
        if (n.remove) trailing.push(this.iconBtn('×', false, n.remove));
        else if (isTop) trailing.push(this.iconBtn('×', false, () => this.deleteWidget(n.path)));

        // Every row is draggable and a drop target (DnD is delegated on the list —
        // see wireTreeDnd — keyed by data-path so it survives tree re-renders).
        // Drop onto a container → move inside it; onto a list child → reorder /
        // move into that list; onto a top-level row → reorder top level.
        const title = n.isContainer ? 'Drag a widget onto me to nest it here' : 'Drag to move / reorder';
        const li = html`<li draggable="true" data-path=${n.path}
            class=${'explore-tree__item' + (n.path === sel ? ' is-selected' : '') + (n.isContainer ? ' is-container' : '')}
            style=${n.depth ? `padding-left:${n.depth * 14}px` : ''}>
            <span class="explore-tree__grip" title=${title}>⠿</span>
            ${name}
            ${trailing}
        </li>` as HTMLElement;
        out.push(li);

        for (const c of n.children) this.appendTreeRows(c, sel, out);
    }

    // Drag-and-drop is DELEGATED on the persistent tree <ul> (wired once in
    // buildTreeShell), keyed by each row's data-path. Delegation is essential:
    // the row <li>s are replaced on every tree re-render, so per-row listeners
    // would be lost mid-interaction — the earlier bug where dropping onto a
    // nested row did nothing. The <ul> node is stable, so these listeners
    // survive every repaint. `closest('li[data-path]')` finds the row under the
    // pointer at event time.
    private wireTreeDnd() {
        const list = this.elTreeList;
        const rowOf = (e: Event) => (e.target as HTMLElement | null)?.closest('li[data-path]') as HTMLElement | null;

        list.addEventListener('dragstart', (e: DragEvent) => {
            const li = rowOf(e);
            if (!li) return;
            this.dragPath = li.dataset.path ?? null;
            e.dataTransfer?.setData('text/plain', this.dragPath ?? '');
            if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        });
        // A row under the pointer targets that row; empty space in the list
        // targets the ROOT (top level) — the way to pull a nested widget back
        // out to the top level (drop on a top-level row promotes it to that
        // position; drop on empty space appends it).
        list.addEventListener('dragover', (e: DragEvent) => {
            if (!this.dragPath) return;
            const li = rowOf(e);
            const targetPath = li?.dataset.path ?? null;
            if (!this.isValidDrop(this.dragPath, targetPath)) return;
            e.preventDefault(); // required so `drop` fires
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            // Show the indicator at the position the drop will ACTUALLY land:
            // a container row → box (drop inside); any other row → a line at its
            // top (before) or bottom (after); empty space → the list (top level).
            this.clearDropTarget();
            if (!li) { list.classList.add('is-drop-target'); this.dropTargetEl = list; return; }
            const cls = this.isContainerPath(targetPath!) ? 'is-drop-into'
                : this.dropAfter(li, e.clientY) ? 'is-drop-after' : 'is-drop-before';
            li.classList.add(cls);
            this.dropTargetEl = li;
        });
        list.addEventListener('drop', (e: DragEvent) => {
            const li = rowOf(e);
            const targetPath = li?.dataset.path ?? null;
            this.clearDropTarget();
            if (!this.dragPath || !this.isValidDrop(this.dragPath, targetPath)) return;
            e.preventDefault();
            const after = li ? this.dropAfter(li, e.clientY) : false;
            this.onDrop(this.dragPath, targetPath, after);
            this.dragPath = null;
        });
        list.addEventListener('dragend', () => { this.clearDropTarget(); this.dragPath = null; });
    }

    // Pointer in the row's lower half → insert AFTER the target (the only way to
    // reach the END of a children collection by dropping on its last item).
    private dropAfter(li: HTMLElement, clientY: number): boolean {
        const r = li.getBoundingClientRect();
        return clientY > r.top + r.height / 2;
    }

    private isContainerPath(path: string): boolean {
        const ref = this.resolveNode(path);
        return !!ref && this.containerFields(ref.node.type).length > 0;
    }

    private clearDropTarget() {
        this.dropTargetEl?.classList.remove('is-drop-target', 'is-drop-into', 'is-drop-before', 'is-drop-after');
        this.dropTargetEl = null;
    }

    // A drop of src is valid unless: nothing dragged; onto itself; or onto its
    // own descendant (cycle). targetPath === null means the ROOT (top level),
    // always a valid destination. Any row is a target — onDrop picks the action.
    private isValidDrop(src: string, targetPath: string | null): boolean {
        if (!src) return false;
        if (targetPath === null) return true;                                  // → top level
        if (src === targetPath || targetPath.startsWith(src + '/')) return false;
        return this.resolveNode(targetPath) !== null;
    }

    private onDrop(src: string, targetPath: string | null, after = false) {
        if (targetPath === null) { this.moveNodeToTopLevel(src, null, false); return; } // empty space → append top level
        const targetRef = this.resolveNode(targetPath);
        if (!targetRef) return;
        if (this.containerFields(targetRef.node.type).length > 0) {
            this.moveNodeIntoContainer(src, targetPath);                 // drop onto a container → nest inside (append)
        } else if (targetRef.parent?.shape === 'list') {
            this.moveNodeBeforeListSibling(src, targetPath, after);      // drop onto a list child → insert before/after
        } else if (targetRef.parent?.shape === 'map') {
            this.moveNodeBeforeMapSibling(src, targetPath, after);       // drop onto a grid area → insert before/after
        } else if (this.isTopLevelPath(src)) {
            this.reorderTopLevel(src, targetPath, after);               // top-level reorder (keeps id/card)
        } else {
            this.moveNodeToTopLevel(src, targetPath, after);            // promote a nested widget to this top-level slot
        }
    }

    // Reorder a top-level widget relative to another, preserving its id (so its
    // preview card is kept, not rebuilt). Recomputes the target index after
    // removing src, and allows landing at the very end (index === length).
    private reorderTopLevel(srcId: string, targetId: string, after: boolean) {
        const arr = this.state.widgets;
        const from = arr.findIndex((w) => w.id === srcId);
        if (from < 0) return;
        const [item] = arr.splice(from, 1);
        let to = arr.findIndex((w) => w.id === targetId);
        to = to < 0 ? arr.length : to + (after ? 1 : 0);
        arr.splice(to, 0, item);
        this.markStructureChanged();
    }

    private isTopLevelPath(path: string): boolean {
        return !path.includes('/');
    }

    // Pull the node at srcPath out to the top level: extract it, wrap it as a
    // top-level widget (fresh id — children carry none), and insert before (or
    // after) the top-level widget at targetPath (append when targetPath is null).
    // Index is computed AFTER extraction so a top-level→top-level move lands right.
    private moveNodeToTopLevel(srcPath: string, targetPath: string | null, after: boolean) {
        const moved = this.extractNode(srcPath);
        if (!moved) return;
        const w: WidgetState = { id: `w${this.idSeq++}`, type: moved.type, props: moved.props };
        let idx = this.state.widgets.length;
        if (targetPath) {
            const t = this.topIndexOf(targetPath);
            if (t >= 0) idx = t + (after ? 1 : 0);
        }
        this.state.widgets.splice(idx, 0, w);
        this.ui.selectedId = w.id;
        this.markStructureChanged(true);
    }

    // Insert src into a LIST container before/after the target child (the "inside
    // group reorder / move-in" case). The parent list reference and the target
    // object identity are captured before extraction so the insert index is
    // correct even when src was removed from the same list ahead of it.
    private moveNodeBeforeListSibling(srcPath: string, targetPath: string, after: boolean) {
        if (targetPath === srcPath || targetPath.startsWith(srcPath + '/')) return;
        const targetRef = this.resolveNode(targetPath);
        if (!targetRef || targetRef.parent?.shape !== 'list') return;
        const arr = targetRef.parent.arr;
        const targetObj = arr[targetRef.parent.index];
        const moved = this.extractNode(srcPath);
        if (!moved) return;
        let idx = arr.indexOf(targetObj);
        idx = idx < 0 ? arr.length : idx + (after ? 1 : 0);
        arr.splice(idx, 0, { type: moved.type, props: moved.props });
        this.ui.selectedId = null;
        this.markStructureChanged(true);
    }

    // Insert src into a MAP container (grid areas) before/after the target child.
    // Areas are positional (order = sorted keys a, b, c, …), so any insert means
    // renumbering: read the ordered children, splice src in at the target (by
    // identity, recomputed after extraction), then rewrite the keys a, b, c, ….
    private moveNodeBeforeMapSibling(srcPath: string, targetPath: string, after: boolean) {
        if (targetPath === srcPath || targetPath.startsWith(srcPath + '/')) return;
        const targetRef = this.resolveNode(targetPath);
        if (!targetRef || targetRef.parent?.shape !== 'map') return;
        const map = targetRef.parent.map;
        const targetObj = map[targetRef.parent.key];
        const moved = this.extractNode(srcPath); // may remove a key from this same map
        if (!moved) return;

        const ordered = Object.keys(map).sort().map((k) => map[k]);
        let at = ordered.indexOf(targetObj);
        at = at < 0 ? ordered.length : at + (after ? 1 : 0);
        ordered.splice(at, 0, { type: moved.type, props: moved.props } as WidgetNode);

        for (const k of Object.keys(map)) delete map[k];
        ordered.forEach((obj, i) => { map[this.areaNameForIndex(i)] = obj; });

        this.ui.selectedId = null;
        this.markStructureChanged(true);
    }

    private topIndexOf(path: string): number {
        return this.state.widgets.findIndex((w) => w.id === path);
    }

    // Move the node at srcPath to become the last child of the container at
    // destPath. The destination node object reference is captured BEFORE the
    // extraction so it survives any index shift the removal causes; the moved
    // envelope is deep-cloned and stripped of its (top-level-only) id.
    private moveNodeIntoContainer(srcPath: string, destPath: string) {
        if (destPath === srcPath || destPath.startsWith(srcPath + '/')) return; // no cycle
        const destRef = this.resolveNode(destPath);
        if (!destRef) return;
        const cf = this.containerFields(destRef.node.type)[0];
        if (!cf) return;
        const destProps = destRef.node.props; // stable reference across the extraction
        const moved = this.extractNode(srcPath);
        if (!moved) return;
        const child: WidgetNode = { type: moved.type, props: moved.props };
        if (cf.shape === 'list') {
            (this.ensureContainer(destProps, cf.name, 'list') as WidgetNode[]).push(child);
        } else {
            const map = this.ensureContainer(destProps, cf.name, 'map') as Record<string, WidgetNode>;
            map[this.nextAreaName(map)] = child;
        }
        // Paths are index/key based and the tree just changed shape; drop the
        // selection rather than risk pointing it at the wrong node.
        this.ui.selectedId = null;
        this.markStructureChanged(true);
    }

    // Remove the node at `path` from its parent and return a plain (de-proxied,
    // deep-cloned) {type, props} envelope — the unit that can be re-inserted as a
    // child elsewhere. Returns null for an unresolvable path.
    private extractNode(path: string): WidgetNode | null {
        const ref = this.resolveNode(path);
        if (!ref) return null;
        const src = raw(ref.node) as WidgetNode & { id?: string };
        const clone: WidgetNode = { type: src.type, props: deepClone(src.props) };
        if (!ref.parent) {
            const idx = this.topIndexOf(path);
            if (idx >= 0) this.state.widgets.splice(idx, 1);
        } else if (ref.parent.shape === 'list') {
            ref.parent.arr.splice(ref.parent.index, 1);
        } else {
            delete ref.parent.map[ref.parent.key];
        }
        return clone;
    }

    private iconBtn(label: string, disabled: boolean, onClick: () => void): HTMLButtonElement {
        const b = html`<button class="explore-btn explore-btn--icon" onclick=${onClick}>${label}</button>` as HTMLButtonElement;
        b.disabled = disabled;
        return b;
    }

    // Commit a structural change (add/remove/move): snapshot history and rebuild
    // the inspector; the tree repaints reactively from the changed state. Pass
    // refreshPreview when a container's children changed so its preview card
    // re-renders (bumps buildRev).
    private markStructureChanged(refreshPreview = false) {
        if (refreshPreview) this.ui.buildRev++;
        this.pushHistory();
        this.scheduleInspector();
    }

    private addWidget(type: string) {
        if (!type || !this.formModel?.widgets[type]) return;
        const w: WidgetState = {id: `w${this.idSeq++}`, type, props: deepClone(this.formModel.widgets[type].defaults)};
        this.state.widgets.push(w);
        this.ui.selectedId = w.id;
        this.markStructureChanged();
    }

    private deleteWidget(id: string) {
        this.state.widgets = this.state.widgets.filter((w) => w.id !== id);
        // Clear the selection when it is this widget or any node nested inside it.
        if (this.topIdOf(this.ui.selectedId) === id) this.ui.selectedId = null;
        this.markStructureChanged();
    }

    // ---- child (nested widget) mutations ----------------------------------
    // parentPath addresses the CONTAINER node (whose props hold `fieldName`).
    // Each commits via markStructureChanged(true): the tree repaints reactively
    // and the container's preview card re-renders (buildRev) so the added/removed/
    // reordered child shows immediately.

    private addChild(parentPath: string, fieldName: string, shape: 'list' | 'map', type: string, areaName?: string) {
        if (!type || !this.formModel?.widgets[type]) return;
        const ref = this.resolveNode(parentPath);
        if (!ref) return;
        const child: WidgetNode = { type, props: deepClone(this.formModel.widgets[type].defaults) };
        if (shape === 'map') {
            const map = this.ensureContainer(ref.node.props, fieldName, 'map') as Record<string, WidgetNode>;
            // Area names are positional and automatic (a, b, c, …): the caller
            // (control / drop) supplies none, so the grid needs no area config.
            const name = (areaName ?? '').trim() || this.nextAreaName(map);
            if (map[name]) return; // never clobber an existing area
            map[name] = child;
        } else {
            (this.ensureContainer(ref.node.props, fieldName, 'list') as WidgetNode[]).push(child);
        }
        this.markStructureChanged(true);
    }

    // The i-th positional area name: a, b, …, z, aa, ab, … (grid areas are
    // positional; render/marshal order is the sorted key order, and this scheme
    // sorts the same as the sequence for the common < 26 case).
    private areaNameForIndex(i: number): string {
        return i < 26
            ? String.fromCharCode(97 + i)
            : String.fromCharCode(97 + Math.floor(i / 26) - 1) + String.fromCharCode(97 + (i % 26));
    }

    // The next area name not already used (1st child → "a", 2nd → "b"; a gap
    // left by a deletion is reused before spilling past "z").
    private nextAreaName(map: Record<string, unknown>): string {
        for (let i = 0; ; i++) {
            const name = this.areaNameForIndex(i);
            if (!(name in map)) return name;
        }
    }

    private removeChild(parentPath: string, fieldName: string, shape: 'list' | 'map', key: string) {
        const ref = this.resolveNode(parentPath);
        if (!ref) return;
        const container = ref.node.props[fieldName];
        if (shape === 'list' && Array.isArray(container)) container.splice(parseInt(key, 10), 1);
        else if (shape === 'map' && container && typeof container === 'object') delete container[key];
        this.reselectToContainer(parentPath, fieldName);
        this.markStructureChanged(true);
    }

    private moveChild(parentPath: string, fieldName: string, index: number, delta: number) {
        const ref = this.resolveNode(parentPath);
        if (!ref) return;
        const arr = ref.node.props[fieldName];
        if (!Array.isArray(arr)) return;
        const to = index + delta;
        if (to < 0 || to >= arr.length) return;
        const [item] = arr.splice(index, 1);
        arr.splice(to, 0, item);
        this.reselectToContainer(parentPath, fieldName);
        this.markStructureChanged(true);
    }

    private ensureContainer(props: any, name: string, shape: 'list' | 'map'): any {
        if (shape === 'list') {
            if (!Array.isArray(props[name])) props[name] = [];
        } else {
            const v = props[name];
            if (!v || typeof v !== 'object' || Array.isArray(v)) props[name] = {};
        }
        return props[name];
    }

    // Child paths under a container are index/area-name based, so a remove or
    // reorder there can make the current selection stale. If the selection points
    // into the mutated container, drop it back to the container itself.
    private reselectToContainer(parentPath: string, fieldName: string) {
        const sel = this.ui.selectedId;
        if (sel && sel.startsWith(`${parentPath}/${fieldName}/`)) this.ui.selectedId = parentPath;
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
        // Drop the selection if its path no longer resolves in the restored state
        // (handles nested child paths, not just top-level ids).
        if (this.ui.selectedId && !this.resolveNode(this.ui.selectedId)) {
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
        const selPath = this.ui.selectedId;
        const ref = this.resolveNode(selPath);
        if (!ref || selPath === null) {
            insp.innerHTML = '<div class="explore-empty">Select a widget to edit its options.</div>';
            return;
        }
        const node = ref.node;
        const descriptor = this.formModel!.widgets[node.type];

        // Title row. Chart widgets get a type switcher (remap field choices onto
        // the new type's slots by role, see switchType); container/parameter
        // widgets show a static type label — their type is not interchangeable.
        if (descriptor.category === 'chart') {
            const chartTypes = Object.keys(this.formModel!.widgets)
                .filter((t) => this.formModel!.widgets[t].category === 'chart');
            const typeSel = html`<select class="explore-input explore-inspector__type"
                onchange=${() => this.switchType(node, typeSel.value)}>${
                chartTypes.map((t) => html`<option value=${t}>${this.formModel!.widgets[t].title}</option>`)}</select>` as HTMLSelectElement;
            typeSel.value = node.type;
            insp.appendChild(html`<div class="explore-inspector__title">${typeSel}</div>`);
        } else {
            insp.appendChild(html`<div class="explore-inspector__title">
                <span class="explore-inspector__type-label">${descriptor.title}</span>
            </div>`);
        }

        // Client-side validation panel: lists required-but-empty fields. Updated
        // live by the delegated input listener (wireInspectorInteractions) and on
        // build/undo — a purely local, understandable check (no server round-trip).
        this.elInspectorValidation = html`<div></div>` as HTMLElement;
        insp.appendChild(this.elInspectorValidation);

        const queryKey = descriptor.queryKey;
        // Controls write into node.props (the reactive proxy) — the per-widget
        // preview effect and the persist effect react. No onChange plumbing.
        // Nested widgets are NOT edited here (they are managed in the tree);
        // renderForm filters childrenList/childrenMap fields out of the form.
        const ctx: ControlCtx = {
            baseUrl: this.baseUrl,
            schema: this.schema,
            fieldKinds: this.formModel!.fieldKinds ?? [],
            getTable: () => {
                const q = queryKey ? node.props[queryKey] : null;
                return q && q.kind === 'table' ? q.table : null;
            },
        };
        const form = document.createElement('div');
        renderForm(form, descriptor, node.props, ctx);
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
    // Mutates the node's type + props in the reactive proxy then commits (Build)
    // so the preview re-renders and the change lands on the undo history. The
    // inspector effect (which tracks the resolved node.type) rebuilds the form.
    // Works for a top-level widget or a nested child alike (both are WidgetNode).
    private switchType(node: WidgetNode, newType: string) {
        if (!newType || newType === node.type || !this.formModel?.widgets[newType]) return;
        const remapped = this.remapProps(node.type, newType, raw(node.props));
        node.type = newType;
        // Replace props contents in place (keep the same reactive proxy object so
        // the per-card preview effect and controls stay bound to it).
        for (const k of Object.keys(node.props)) delete node.props[k];
        Object.assign(node.props, remapped);
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

        // (4) like-named scalar/composite options (not fields, not the query,
        //     not nested children — those don't carry across a chart-type swap).
        for (const oldF of oldDesc.fields) {
            if (oldF.editor === 'field' || oldF.editor === 'childrenList' || oldF.editor === 'childrenMap') continue;
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
    private validateWidget(w: WidgetNode): string[] {
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
        const ref = this.resolveNode(this.ui.selectedId);
        const issues = ref ? this.validateWidget(ref.node) : [];
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

        // A card is the unit of a TOP-LEVEL widget; a nested child has no card of
        // its own (its container renders it server-side), so map any selection to
        // its top-level ancestor for highlighting + scroll.
        const topSel = this.topIdOf(sel);
        for (const w of widgets) {
            let entry = this.previews[w.id];
            if (!entry) entry = this.mountWidgetPreview(w.id);
            entry.card.classList.toggle('is-selected', w.id === topSel);
            pv.appendChild(entry.card); // re-append = reorder, keeps the node (no refetch)
        }

        // When the selection *changes*, scroll its preview card into the middle of
        // the preview pane — so picking a widget in the tree reveals it. Guarded on
        // a change so structural repaints (add/delete/reorder) don't re-scroll.
        if (topSel && topSel !== this.lastScrolledSel && this.previews[topSel]) {
            this.previews[topSel].card.scrollIntoView({block: 'center', behavior: 'smooth'});
        }
        this.lastScrolledSel = topSel;
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

    // Go code tab: the whole dashboard as fluent-builder Go (docs requirement
    // #1 — copy/paste "graduation" into the repo). The server (POST /api/gocode)
    // owns generation: the field↔builder-method table is generated by dashica-gen
    // and the value emitters live in Go, so there is zero widget-shape knowledge
    // in the frontend. A copy button and a <pre> that the gocode-sync effect keeps
    // fresh; the initial content is fetched here.
    private buildGocodeTab(content: HTMLElement) {
        const pre = html`<pre class="explore-input explore-textarea explore-gocode" spellcheck="false">Generating…</pre>` as HTMLElement;
        const copy = html`<button class="explore-btn explore-btn--sm" onclick=${() => {
            navigator.clipboard.writeText(pre.textContent ?? '');
            copy.textContent = 'Copied!';
            setTimeout(() => { copy.textContent = 'Copy Go code'; }, 1500);
        }}>Copy Go code</button>` as HTMLButtonElement;
        content.append(html`<div class="explore-gocode__bar">${copy}</div>`, pre);
        this.gocodePre = pre;
        // Force the first generate (bypass the unchanged-since-last guard) by
        // reading state untracked — this runs inside the drawer effect, so
        // tracking state here would rebuild the <pre> on every keystroke.
        this.gocodeLastJson = null;
        this.fetchGocode(JSON.stringify(raw(this.state)));
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
        const ref = this.resolveNode(selectedId);
        if (!ref) {
            content.innerHTML = '<div class="explore-empty">Select a widget to inspect its data.</div>';
            return;
        }
        const table = this.getWidgetTable(ref.node);
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
    private getWidgetTable(w: WidgetNode): string | null {
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

// Default layout for the Explore editor dock (§4.4). Every pane is an `adopt`
// panel with renderer:'always' so its moved DOM (and live Alpine components) stay
// mounted while hidden. preview-controls is a locked, header-less strip pinned
// above the preview cards — it is the previewed dashboard's state, not a
// user-draggable pane. The drawer's three tabs are one group (direction 'within').
// VSCode/dockview-demo shape using EDGE GROUPS (dockview.dev/docs/core/groups/
// edgeGroups): the tree is a LEFT edge group and the inspector a RIGHT edge group
// — collapsible sidebars docked to the shell edge, outside the main grid. The
// centre main grid holds the dominant preview with its locked time-strip above
// and the Data / Go code / JSON drawer tab group below. `closable` (in params)
// drives the custom tab's × — only the tree gets one.
function exploreLayout(api: DockviewApi) {
    const R = { renderer: 'always' as const };
    const adopt = (id: string, closable = false) =>
        ({ id, component: 'adopt', params: { adopt: id, closable }, ...R });

    // Edge groups (collapsible; permanent structural slots): tree LEFT, inspector
    // RIGHT, drawer BOTTOM. The centre main grid keeps just the preview + its
    // locked time-strip, so the preview stays dominant.
    api.addEdgeGroup('left', { id: 'tree-edge', initialSize: 200, minimumSize: 200 });
    api.addEdgeGroup('right', { id: 'inspector-edge', initialSize: 300, minimumSize: 300 });
    api.addEdgeGroup('bottom', { id: 'drawer-edge', initialSize: 220, minimumSize: 100 });

    // Centre main grid: preview dominant, with the locked time-strip above it.
    api.addPanel({ ...adopt('preview'), title: 'Preview' });
    api.addPanel({ ...adopt('preview-controls'),
        position: { referencePanel: 'preview', direction: 'above' }, initialHeight: 40, maximumHeight: 100 });
    const pc = api.getPanel('preview-controls');
    if (pc) {
        pc.group.locked = 'no-drop-target';
        pc.group.header.hidden = true;
    }

    // Drawer tab group (Data / Go code / JSON) into the BOTTOM edge group.
    api.addPanel({ ...adopt('drawer-data'), title: 'Data',
        position: { referenceGroup: 'drawer-edge' } });
    api.addPanel({ ...adopt('drawer-gocode'), title: 'Go code',
        position: { referencePanel: 'drawer-data', direction: 'within' } });
    api.addPanel({ ...adopt('drawer-json'), title: 'JSON',
        position: { referencePanel: 'drawer-data', direction: 'within' } });

    // Sidebar panels into their edge groups (tree removable, inspector not).
    api.addPanel({ ...adopt('tree'), title: 'Tree',
        position: { referenceGroup: 'tree-edge' } });
    api.addPanel({ ...adopt('inspector'), title: 'Inspector',
        position: { referenceGroup: 'inspector-edge' } });

    // Land on the Data tab.
    api.getPanel('drawer-data')?.api.setActive();

    // Debug drawer starts absent — added lazily on the first wrench click as a
    // big, maximizable split BELOW the centre preview panel (full-width, so the
    // query/EXPLAIN are readable). Replaces the old page-level daisyUI
    // DebugDrawer wrapper.
    wireLazyDebugDrawer(api, 'preview');
}

// The assembled Explore dock, built by initExploreDock() BEFORE Alpine.start()
// (§4.2 rule 2) and read by the Alpine boundary below to hand into the Editor.
let exploreDockApi: DockviewApi | null = null;

// initExploreDock assembles the dock and adopts the staged panes into it. Called
// from the Explore page's inline script before window.Alpine.start(), so the
// panes (and the searchBar inside preview-controls) are in their final position
// when Alpine walks the tree — no re-init, no reparenting edge cases (§4.8 Q1).
export function initExploreDock() {
    const container = document.getElementById('explore-dock');
    if (!container) return; // not the Explore page
    exploreDockApi = initDock(container, EXPLORE_DOCK_KEY, exploreLayout);
}

// Alpine boundary: create the filter scope, construct the plain Editor with the
// pre-built dock, start it. The editor root carries [data-filter-scope]; the
// scope is created here (before the preview charts mount, since Alpine inits
// parents first) so the preview strip's SQL filter + the global $store.timeState
// drive the preview charts automatically — the editor needs no filter effect.
export default () => ({
    init() {
        createFilterScope(this.$el, { syncUrl: true });
        const editor = new Editor(this.$el, this.$el.dataset.baseUrl || '', exploreDockApi);
        editor.start();
    },
});
