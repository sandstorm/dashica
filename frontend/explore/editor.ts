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
import {html} from "htl";
import {classBadge, Column, ControlCtx, FieldKind, SchemaResponse} from "./controls";
import {renderForm, WidgetDescriptor} from "./formRenderer";
import {mountPreview, PreviewController, WidgetEnvelope} from "./preview";

interface WidgetState { id: string; type: string; props: Record<string, any>; }
interface DashboardState { title: string; layout: string; widgets: WidgetState[]; }
interface WidgetFormModel extends WidgetDescriptor { defaults: Record<string, any>; }
interface FormModel { widgets: Record<string, WidgetFormModel>; layouts: string[]; fieldKinds: FieldKind[]; }

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

        this.layoutSel = html`<select class="explore-input" onchange=${() => { this.state.layout = this.layoutSel.value; }}>${
            (this.formModel?.layouts ?? []).map((l) => html`<option value=${l}>${l}</option>`)}</select>` as HTMLSelectElement;

        const share = html`<button class="explore-btn" onclick=${() => {
            navigator.clipboard.writeText(this.shareUrl());
            share.textContent = 'Copied!';
            setTimeout(() => { share.textContent = 'Copy share link'; }, 1500);
        }}>Copy share link</button>` as HTMLButtonElement;

        this.elToolbar.replaceChildren(this.titleInput, this.layoutSel, share);
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
            return html`<li class=${'explore-tree__item' + (w.id === sel ? ' is-selected' : '')}>
                ${name}
                ${this.iconBtn('↑', i === 0, () => this.move(i, -1))}
                ${this.iconBtn('↓', i === items.length - 1, () => this.move(i, 1))}
                ${this.iconBtn('×', false, () => this.deleteWidget(w.id))}
            </li>`;
        }));
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
        insp.appendChild(html`<div class="explore-inspector__title">${descriptor.title}</div>`);

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
            if (!entry) entry = this.mountWidgetPreview(w);
            entry.card.classList.toggle('is-selected', w.id === sel);
            pv.appendChild(entry.card); // re-append = reorder, keeps the node (no refetch)
        }
    }

    private mountWidgetPreview(w: WidgetState): PreviewEntry {
        const body = html`<div class="explore-card__body"></div>` as HTMLElement;
        const card = html`<div class="explore-card" onclick=${() => { this.ui.selectedId = w.id; }}>${body}</div>` as HTMLElement;

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
// Preview charts subscribe to $store.urlState themselves, so the time range
// re-queries them automatically — the editor needs no filter effect.
export default () => ({
    init() {
        const editor = new Editor(this.$el, this.$el.dataset.baseUrl || '', this.$store.urlState);
        editor.start();
    },
});
