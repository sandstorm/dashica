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
//  3. Preview deps are coarse on purpose: one effect per card tracks
//     `JSON.stringify(widget.props)`, debounced — correct-by-default.
//  4. Effect lifecycle is explicit: per-widget effects are kept on the preview
//     entry and `Alpine.release`d on widget removal.
//  5. One effect per pane/widget with a name comment; no nested effects except
//     the deliberate per-card effect created once at mount (commented below).

import Alpine from '@alpinejs/csp';
import {ControlCtx, SchemaResponse} from "./controls";
import {renderForm, WidgetDescriptor} from "./formRenderer";
import {mountPreview, PreviewController, WidgetEnvelope} from "./preview";

interface WidgetState { id: string; type: string; props: Record<string, any>; }
interface DashboardState { title: string; layout: string; widgets: WidgetState[]; }
interface WidgetFormModel extends WidgetDescriptor { defaults: Record<string, any>; }
interface FormModel { widgets: Record<string, WidgetFormModel>; layouts: string[]; }

type DrawerTab = 'data' | 'gocode' | 'json';
interface UiState { selectedId: string | null; drawerTab: DrawerTab; drawerCollapsed: boolean; }

interface PreviewEntry {
    card: HTMLElement;
    controller: PreviewController;
    eff: any;         // the per-widget preview effect (released on teardown)
    first: boolean;   // render immediately on the effect's first run, debounce after
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

    // Effects, kept only so a future teardown could release them.
    private effects: any[] = [];

    // Cached DOM refs into the templ shell + built-once controls.
    private elToolbar: HTMLElement;
    private elTree: HTMLElement;
    private elPreview: HTMLElement;
    private elInspector: HTMLElement;
    private elDrawer: HTMLElement;
    private titleInput!: HTMLInputElement;
    private layoutSel!: HTMLSelectElement;
    private elTreeList!: HTMLElement;
    private elDrawerTabs!: HTMLElement;
    private elDrawerCollapse!: HTMLButtonElement;
    private elDrawerContent!: HTMLElement;
    private jsonTextarea: HTMLTextAreaElement | null = null;

    private inspectorScheduled = false;

    constructor(private root: HTMLElement, private baseUrl: string, private urlState: any) {
        this.elToolbar = root.querySelector('[data-explore="toolbar"]')!;
        this.elTree = root.querySelector('[data-explore="tree"]')!;
        this.elPreview = root.querySelector('[data-explore="preview"]')!;
        this.elInspector = root.querySelector('[data-explore="inspector"]')!;
        this.elDrawer = root.querySelector('[data-explore="drawer"]')!;
    }

    async start() {
        this.ui = Alpine.reactive({selectedId: null, drawerTab: 'data', drawerCollapsed: false} as UiState);
        this.state = Alpine.reactive(this.loadState());
        this.reseedIdSeq();

        try {
            const [fm, sc] = await Promise.all([
                fetch(`${this.baseUrl}/api/formmodel`).then((r) => { if (!r.ok) throw new Error(`formmodel ${r.status}`); return r.json(); }),
                fetch(`${this.baseUrl}/api/schema`).then((r) => r.ok ? r.json() : null).catch(() => null),
            ]);
            this.formModel = fm;
            this.schema = sc;
        } catch (e: any) {
            this.root.innerHTML = '';
            const msg = document.createElement('div');
            msg.className = 'explore-empty';
            msg.textContent = `Explore API unavailable (${e.message}). Reload to retry.`;
            this.root.appendChild(msg);
            return;
        }

        // Build the static shells once, then wire the effects that keep the
        // dynamic parts in sync. Effect first-runs paint the initial state.
        this.buildToolbar();
        this.buildTreeShell();
        this.buildDrawerShell();
        this.wireFilterToggle();
        this.wireEffects();
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
    // reference). Used by the JSON tab and share-link apply. Previews are torn
    // down first so the reconcile effect rebuilds each card + per-widget effect
    // against the NEW widget objects (fixes stale JSON-tab previews).
    private applyState(ns: DashboardState) {
        for (const id of Object.keys(this.previews)) this.teardownPreview(id);
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

        // toolbar sync: title/layout inputs reflect state when not focused.
        this.effects.push(Alpine.effect(() => {
            const t = this.state.title, l = this.state.layout;
            if (document.activeElement !== this.titleInput) this.titleInput.value = t;
            if (document.activeElement !== this.layoutSel) this.layoutSel.value = l;
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
        this.elToolbar.innerHTML = '';

        this.titleInput = document.createElement('input');
        this.titleInput.className = 'explore-input explore-toolbar__title';
        this.titleInput.placeholder = 'Dashboard title';
        this.titleInput.addEventListener('input', () => { this.state.title = this.titleInput.value; });
        this.elToolbar.appendChild(this.titleInput);

        this.layoutSel = document.createElement('select');
        this.layoutSel.className = 'explore-input';
        for (const l of this.formModel?.layouts ?? []) {
            const o = document.createElement('option'); o.value = l; o.textContent = l; this.layoutSel.appendChild(o);
        }
        this.layoutSel.addEventListener('change', () => { this.state.layout = this.layoutSel.value; });
        this.elToolbar.appendChild(this.layoutSel);

        const share = document.createElement('button');
        share.className = 'explore-btn';
        share.textContent = 'Copy share link';
        share.addEventListener('click', () => {
            navigator.clipboard.writeText(this.shareUrl());
            share.textContent = 'Copied!';
            setTimeout(() => { share.textContent = 'Copy share link'; }, 1500);
        });
        this.elToolbar.appendChild(share);
    }

    private shareUrl(): string {
        const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(this.state))));
        return `${window.location.origin}${window.location.pathname}#s=${encoded}`;
    }

    // ---- tree --------------------------------------------------------------

    private buildTreeShell() {
        this.elTree.innerHTML = '';

        const addRow = document.createElement('div');
        addRow.className = 'explore-tree__add';
        const sel = document.createElement('select');
        sel.className = 'explore-input';
        for (const type of Object.keys(this.formModel?.widgets ?? {})) {
            const o = document.createElement('option');
            o.value = type;
            o.textContent = this.formModel!.widgets[type].title;
            sel.appendChild(o);
        }
        const add = document.createElement('button');
        add.className = 'explore-btn explore-btn--sm';
        add.textContent = '+ add';
        add.addEventListener('click', () => this.addWidget(sel.value));
        addRow.append(sel, add);
        this.elTree.appendChild(addRow);

        this.elTreeList = document.createElement('ul');
        this.elTreeList.className = 'explore-tree__list';
        this.elTree.appendChild(this.elTreeList);
    }

    private renderTreeList(items: {id: string; type: string}[], sel: string | null) {
        const list = this.elTreeList;
        list.innerHTML = '';
        items.forEach((w, i) => {
            const li = document.createElement('li');
            li.className = 'explore-tree__item' + (w.id === sel ? ' is-selected' : '');
            const name = document.createElement('span');
            name.className = 'explore-tree__name';
            name.textContent = this.formModel?.widgets[w.type]?.title ?? w.type;
            name.addEventListener('click', () => { this.ui.selectedId = w.id; });
            li.appendChild(name);

            const up = this.iconBtn('↑', i === 0, () => this.move(i, -1));
            const down = this.iconBtn('↓', i === items.length - 1, () => this.move(i, 1));
            const del = this.iconBtn('×', false, () => this.deleteWidget(w.id));
            li.append(up, down, del);
            list.appendChild(li);
        });
    }

    private iconBtn(label: string, disabled: boolean, onClick: () => void): HTMLButtonElement {
        const b = document.createElement('button');
        b.className = 'explore-btn explore-btn--icon';
        b.textContent = label;
        b.disabled = disabled;
        b.addEventListener('click', onClick);
        return b;
    }

    private addWidget(type: string) {
        if (!type || !this.formModel?.widgets[type]) return;
        const w: WidgetState = {id: `w${this.idSeq++}`, type, props: deepClone(this.formModel.widgets[type].defaults)};
        this.state.widgets.push(w);
        this.ui.selectedId = w.id;
    }

    private deleteWidget(id: string) {
        this.state.widgets = this.state.widgets.filter((w) => w.id !== id);
        if (this.ui.selectedId === id) this.ui.selectedId = null;
    }

    private move(index: number, dir: number) {
        const j = index + dir;
        const arr = this.state.widgets;
        if (j < 0 || j >= arr.length) return;
        [arr[index], arr[j]] = [arr[j], arr[index]];
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
        const w = this.state.widgets.find((x) => x.id === this.ui.selectedId);
        if (!w) {
            insp.innerHTML = '<div class="explore-empty">Select a widget to edit its options.</div>';
            return;
        }
        const descriptor = this.formModel!.widgets[w.type];
        const heading = document.createElement('div');
        heading.className = 'explore-inspector__title';
        heading.textContent = descriptor.title;
        insp.appendChild(heading);

        const queryKey = descriptor.queryKey;
        // Controls write into w.props (the reactive proxy) — the per-widget
        // preview effect and the persist effect react. No onChange plumbing.
        const ctx: ControlCtx = {
            baseUrl: this.baseUrl,
            schema: this.schema,
            getTable: () => {
                const q = queryKey ? w.props[queryKey] : null;
                return q && q.kind === 'table' ? q.table : null;
            },
        };
        const form = document.createElement('div');
        renderForm(form, descriptor, w.props, ctx);
        insp.appendChild(form);
    }

    // ---- preview (reconcile + one effect per card) -------------------------

    private reconcilePreviews(widgets: WidgetState[], ids: string[], sel: string | null) {
        const pv = this.elPreview;

        for (const id of Object.keys(this.previews)) {
            if (!ids.includes(id)) this.teardownPreview(id);
        }

        if (widgets.length === 0) {
            if (!pv.querySelector('.explore-empty')) {
                pv.innerHTML = '';
                const d = document.createElement('div');
                d.className = 'explore-empty';
                d.textContent = 'Add a widget to start building.';
                pv.appendChild(d);
            }
            return;
        }
        pv.querySelectorAll('.explore-empty').forEach((n) => n.remove());

        for (const w of widgets) {
            let entry = this.previews[w.id];
            if (!entry) entry = this.mountWidgetPreview(w);
            entry.card.classList.toggle('is-selected', w.id === sel);
            pv.appendChild(entry.card); // re-append = reorder, keeps the node (no refetch)
        }
    }

    private mountWidgetPreview(w: WidgetState): PreviewEntry {
        const card = document.createElement('div');
        card.className = 'explore-card';
        card.addEventListener('click', () => { this.ui.selectedId = w.id; });
        const body = document.createElement('div');
        body.className = 'explore-card__body';
        card.appendChild(body);

        const entry: PreviewEntry = {card, controller: mountPreview(body, this.baseUrl), eff: null, first: true};
        this.previews[w.id] = entry;

        const render = () => entry.controller.render(this.envelope(w));
        const debounced = debounce(render);
        // Deliberate per-card effect, created once at mount (guardrail 5): it
        // tracks this widget's props coarsely (JSON.stringify) and re-renders
        // the preview, debounced. Released in teardownPreview.
        entry.eff = Alpine.effect(() => {
            JSON.stringify(w.props); // deep dep on this widget's props only
            if (entry.first) { entry.first = false; render(); }
            else debounced();
        });
        return entry;
    }

    private envelope(w: WidgetState): WidgetEnvelope { return {type: w.type, props: raw(w.props)}; }

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
        this.elDrawer.innerHTML = '';

        // Drag handle along the drawer's top edge → resize its height.
        const resize = document.createElement('div');
        resize.className = 'explore-drawer__resize';
        resize.title = 'Drag to resize';
        this.wireDrawerResize(resize);
        this.elDrawer.appendChild(resize);

        this.elDrawerTabs = document.createElement('div');
        this.elDrawerTabs.className = 'explore-drawer__tabs';
        const tabDefs: [DrawerTab, string][] = [['data', 'Data'], ['gocode', 'Go code'], ['json', 'JSON']];
        for (const [key, label] of tabDefs) {
            const b = document.createElement('button');
            b.className = 'explore-tab';
            b.dataset.tab = key;
            b.textContent = label;
            // Clicking the active tab while expanded collapses; otherwise select + expand.
            b.addEventListener('click', () => {
                if (this.ui.drawerTab === key && !this.ui.drawerCollapsed) { this.ui.drawerCollapsed = true; return; }
                this.ui.drawerTab = key;
                this.ui.drawerCollapsed = false;
            });
            this.elDrawerTabs.appendChild(b);
        }

        const spacer = document.createElement('div');
        spacer.className = 'explore-drawer__tabs-spacer';
        this.elDrawerTabs.appendChild(spacer);

        this.elDrawerCollapse = document.createElement('button');
        this.elDrawerCollapse.className = 'explore-btn explore-btn--sm explore-drawer__collapse';
        this.elDrawerCollapse.addEventListener('click', () => { this.ui.drawerCollapsed = !this.ui.drawerCollapsed; });
        this.elDrawerTabs.appendChild(this.elDrawerCollapse);

        this.elDrawer.appendChild(this.elDrawerTabs);

        this.elDrawerContent = document.createElement('div');
        this.elDrawerContent.className = 'explore-drawer__content';
        this.elDrawer.appendChild(this.elDrawerContent);
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
        const ta = document.createElement('textarea');
        ta.className = 'explore-input explore-textarea explore-json';
        ta.spellcheck = false;
        const status = document.createElement('div');
        status.className = 'explore-json__status';
        ta.addEventListener('input', () => {
            try {
                const ns = validateState(JSON.parse(ta.value));
                this.applyState(ns);
                status.textContent = 'valid — applied';
                status.className = 'explore-json__status is-ok';
            } catch (e: any) {
                status.textContent = e.message;
                status.className = 'explore-json__status is-err';
            }
        });
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

    // Data tab: shows the selected widget's underlying data (columns + sample
    // rows). The full data view is the next slice (docs UX plan (2)); for now a
    // selection-aware placeholder. SQL / EXPLAIN is no longer a drawer tab — the
    // preview chart's own wrench button opens the standard debug drawer.
    private buildDataTab(content: HTMLElement, selectedId: string | null) {
        const w = selectedId ? this.state.widgets.find((x) => x.id === selectedId) : null;
        if (!w) {
            content.innerHTML = '<div class="explore-empty">Select a widget to inspect its data.</div>';
            return;
        }
        content.innerHTML = '<div class="explore-empty">Data view (columns + sample rows) ships in the next slice. ' +
            'Meanwhile, open a preview chart\'s wrench button for its SQL / EXPLAIN.</div>';
    }
}

// Alpine boundary: register the component, construct the plain Editor, start it.
// Preview charts subscribe to $store.urlState themselves, so the time range
// re-queries them automatically — the editor needs no filter effect.
export default () => ({
    init() {
        const editor = new Editor(this.$el, this.$el.dataset.baseUrl || '', this.$store.urlState);
        editor.start();
    },
});
