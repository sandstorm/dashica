// editor.ts — the Explore editor.
//
// Design (per the code review): this is a plain manual-DOM application, NOT
// idiomatic Alpine, and deliberately so — the CSP Alpine build forbids
// expressions with arguments, and a recursive schema-driven form cannot be
// expressed in Alpine templates. Alpine is demoted to a thin boundary: it only
// registers the component and hands us the shared urlState store. All editor
// state lives in the plain `Editor` class below (not in an Alpine proxy).
//
// Data flow is one-directional and explicit:
//   • structural change (add/select/move/delete/JSON-apply)  → update() → save() + render()
//   • value edit inside a control (typing a field)           → onEdit() → save() + refresh selected preview + JSON drawer
// render() redraws every pane from state; previews are keyed by widget id so a
// re-render re-orders/re-highlights without re-fetching unchanged widgets.

import Alpine from '@alpinejs/csp';
import {ControlCtx, SchemaResponse} from "./controls";
import {renderForm, WidgetDescriptor} from "./formRenderer";
import {mountPreview, PreviewController, WidgetEnvelope} from "./preview";

interface WidgetState { id: string; type: string; props: Record<string, any>; }
interface DashboardState { title: string; layout: string; widgets: WidgetState[]; }
interface WidgetFormModel extends WidgetDescriptor { defaults: Record<string, any>; }
interface FormModel { widgets: Record<string, WidgetFormModel>; layouts: string[]; }

const LS_KEY = 'dashica-explore-state';

function debounce<T extends (...a: any[]) => void>(fn: T, ms = 400): T {
    let t: any;
    return ((...args: any[]) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }) as T;
}

function deepClone<T>(v: T): T { return JSON.parse(JSON.stringify(v)); }

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
    private state: DashboardState = {title: 'Untitled', layout: 'defaultPage', widgets: []};
    private selectedId: string | null = null;
    private drawerTab: 'gocode' | 'json' | 'sql' = 'json';
    private idSeq = 0;

    // Non-UI state — kept out of any reactive proxy on purpose.
    private previews: Record<string, {card: HTMLElement; controller: PreviewController}> = {};

    private elToolbar: HTMLElement;
    private elTree: HTMLElement;
    private elPreview: HTMLElement;
    private elInspector: HTMLElement;
    private elDrawer: HTMLElement;

    private onEditDebounced = debounce(() => this.onEdit());

    constructor(private root: HTMLElement, private baseUrl: string, private urlState: any) {
        this.elToolbar = root.querySelector('[data-explore="toolbar"]')!;
        this.elTree = root.querySelector('[data-explore="tree"]')!;
        this.elPreview = root.querySelector('[data-explore="preview"]')!;
        this.elInspector = root.querySelector('[data-explore="inspector"]')!;
        this.elDrawer = root.querySelector('[data-explore="drawer"]')!;
    }

    async start() {
        this.loadState();
        const [fm, sc] = await Promise.all([
            fetch(`${this.baseUrl}/api/formmodel`).then((r) => r.json()),
            fetch(`${this.baseUrl}/api/schema`).then((r) => r.json()).catch(() => null),
        ]);
        this.formModel = fm;
        this.schema = sc;
        this.render();
    }

    // ---- pipelines ---------------------------------------------------------

    /** Structural change: mutate state, persist, redraw everything. */
    private update(mutate: () => void) {
        mutate();
        this.save();
        this.render();
    }

    /** Value edit from a control: state was already mutated in place; persist,
     *  refresh only the edited widget's preview and the JSON drawer. The
     *  inspector is NOT rebuilt, so the focused input keeps focus. */
    private onEdit() {
        this.save();
        if (this.selectedId) this.refreshPreview(this.selectedId);
        if (this.drawerTab === 'json') this.renderDrawer();
    }

    private render() {
        this.renderToolbar();
        this.renderTree();
        this.renderInspector();
        this.renderPreview();
        this.renderDrawer();
    }

    // ---- state persistence -------------------------------------------------

    private loadState() {
        const hash = new URLSearchParams(window.location.hash.slice(1)).get('s');
        if (hash) {
            try {
                this.state = validateState(JSON.parse(decodeURIComponent(escape(atob(hash)))));
                this.reseedIdSeq();
                return;
            } catch (e) { console.warn('Explore: ignoring invalid share link', e); }
        }
        const stored = localStorage.getItem(LS_KEY);
        if (stored) {
            try { this.state = validateState(JSON.parse(stored)); this.reseedIdSeq(); } catch { /* ignore */ }
        }
    }

    private reseedIdSeq() {
        for (const w of this.state.widgets) {
            const n = parseInt((w.id || '').replace(/\D/g, ''), 10);
            if (!isNaN(n) && n >= this.idSeq) this.idSeq = n + 1;
        }
    }

    private save() { localStorage.setItem(LS_KEY, JSON.stringify(this.state)); }

    private shareUrl(): string {
        const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(this.state))));
        return `${window.location.origin}${window.location.pathname}#s=${encoded}`;
    }

    // ---- toolbar -----------------------------------------------------------

    private renderToolbar() {
        this.elToolbar.innerHTML = '';

        const titleInput = document.createElement('input');
        titleInput.className = 'explore-input explore-toolbar__title';
        titleInput.value = this.state.title;
        titleInput.addEventListener('input', () => { this.state.title = titleInput.value; this.save(); });
        this.elToolbar.appendChild(titleInput);

        const layoutSel = document.createElement('select');
        layoutSel.className = 'explore-input';
        for (const l of this.formModel?.layouts ?? []) {
            const o = document.createElement('option'); o.value = l; o.textContent = l; layoutSel.appendChild(o);
        }
        layoutSel.value = this.state.layout;
        layoutSel.addEventListener('change', () => { this.state.layout = layoutSel.value; this.save(); });
        this.elToolbar.appendChild(layoutSel);

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

    // ---- tree --------------------------------------------------------------

    private renderTree() {
        const tree = this.elTree;
        tree.innerHTML = '';

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
        tree.appendChild(addRow);

        const list = document.createElement('ul');
        list.className = 'explore-tree__list';
        this.state.widgets.forEach((w, i) => {
            const li = document.createElement('li');
            li.className = 'explore-tree__item' + (w.id === this.selectedId ? ' is-selected' : '');
            const name = document.createElement('span');
            name.className = 'explore-tree__name';
            name.textContent = this.formModel?.widgets[w.type]?.title ?? w.type;
            name.addEventListener('click', () => this.update(() => { this.selectedId = w.id; }));
            li.appendChild(name);

            const up = this.iconBtn('↑', i === 0, () => this.move(i, -1));
            const down = this.iconBtn('↓', i === this.state.widgets.length - 1, () => this.move(i, 1));
            const del = this.iconBtn('×', false, () => this.deleteWidget(w.id));
            li.append(up, down, del);
            list.appendChild(li);
        });
        tree.appendChild(list);
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
        this.update(() => {
            const w: WidgetState = {id: `w${this.idSeq++}`, type, props: deepClone(this.formModel!.widgets[type].defaults)};
            this.state.widgets.push(w);
            this.selectedId = w.id;
        });
    }

    private deleteWidget(id: string) {
        this.update(() => {
            this.state.widgets = this.state.widgets.filter((w) => w.id !== id);
            if (this.selectedId === id) this.selectedId = null;
        });
    }

    private move(index: number, dir: number) {
        const j = index + dir;
        if (j < 0 || j >= this.state.widgets.length) return;
        this.update(() => {
            const arr = this.state.widgets;
            [arr[index], arr[j]] = [arr[j], arr[index]];
        });
    }

    // ---- inspector ---------------------------------------------------------

    private renderInspector() {
        const insp = this.elInspector;
        insp.innerHTML = '';
        const w = this.state.widgets.find((x) => x.id === this.selectedId);
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
        const ctx: ControlCtx = {
            baseUrl: this.baseUrl,
            schema: this.schema,
            getTable: () => {
                const q = queryKey ? w.props[queryKey] : null;
                return q && q.kind === 'table' ? q.table : null;
            },
            onChange: this.onEditDebounced,
        };
        const form = document.createElement('div');
        renderForm(form, descriptor, w.props, ctx);
        insp.appendChild(form);
    }

    // ---- preview (keyed reconcile: no refetch on select/move) --------------

    private renderPreview() {
        const pv = this.elPreview;

        // Drop previews for widgets that no longer exist.
        for (const id of Object.keys(this.previews)) {
            if (!this.state.widgets.some((w) => w.id === id)) {
                this.previews[id].controller.destroy();
                this.previews[id].card.remove();
                delete this.previews[id];
            }
        }

        if (this.state.widgets.length === 0) {
            pv.innerHTML = '<div class="explore-empty">Add a widget to start building.</div>';
            return;
        }
        // Clear any placeholder text node without touching existing cards.
        pv.querySelectorAll('.explore-empty').forEach((n) => n.remove());

        for (const w of this.state.widgets) {
            let entry = this.previews[w.id];
            if (!entry) {
                const card = document.createElement('div');
                card.className = 'explore-card';
                card.addEventListener('click', () => this.update(() => { this.selectedId = w.id; }));
                const body = document.createElement('div');
                body.className = 'explore-card__body';
                card.appendChild(body);
                entry = {card, controller: mountPreview(body, this.baseUrl)};
                this.previews[w.id] = entry;
                entry.controller.render(this.envelope(w)); // only new cards fetch
            }
            entry.card.classList.toggle('is-selected', w.id === this.selectedId);
            pv.appendChild(entry.card); // re-append = reorder, keeps the node (no refetch)
        }
    }

    private envelope(w: WidgetState): WidgetEnvelope { return {type: w.type, props: w.props}; }

    private refreshPreview(id: string) {
        const w = this.state.widgets.find((x) => x.id === id);
        const entry = this.previews[id];
        if (w && entry) entry.controller.render(this.envelope(w));
    }

    // ---- drawer (Go code / JSON / SQL) ------------------------------------

    private renderDrawer() {
        const drawer = this.elDrawer;
        drawer.innerHTML = '';

        const tabs = document.createElement('div');
        tabs.className = 'explore-drawer__tabs';
        const tabDefs: [typeof this.drawerTab, string][] = [
            ['gocode', 'Go code'], ['json', 'JSON'], ['sql', 'SQL / debug'],
        ];
        for (const [key, label] of tabDefs) {
            const b = document.createElement('button');
            b.className = 'explore-tab' + (this.drawerTab === key ? ' is-active' : '');
            b.textContent = label;
            b.addEventListener('click', () => { this.drawerTab = key; this.renderDrawer(); });
            tabs.appendChild(b);
        }
        drawer.appendChild(tabs);

        const content = document.createElement('div');
        content.className = 'explore-drawer__content';
        drawer.appendChild(content);

        if (this.drawerTab === 'json') this.renderJsonTab(content);
        else if (this.drawerTab === 'gocode') this.renderGocodeTab(content);
        else this.renderSqlTab(content);
    }

    private renderJsonTab(content: HTMLElement) {
        const ta = document.createElement('textarea');
        ta.className = 'explore-input explore-textarea explore-json';
        ta.spellcheck = false;
        ta.value = JSON.stringify(this.state, null, 2);
        const status = document.createElement('div');
        status.className = 'explore-json__status';
        ta.addEventListener('input', () => {
            try {
                this.state = validateState(JSON.parse(ta.value));
                this.reseedIdSeq();
                status.textContent = 'valid — applied';
                status.className = 'explore-json__status is-ok';
                this.save();
                // Full redraw, but keep this textarea focused: rebuild the other
                // panes, not the drawer (which would replace this element).
                this.renderToolbar();
                this.renderTree();
                this.renderInspector();
                this.renderPreview();
            } catch (e: any) {
                status.textContent = e.message;
                status.className = 'explore-json__status is-err';
            }
        });
        content.append(ta, status);
    }

    private renderGocodeTab(content: HTMLElement) {
        // Go code generation is Phase 4 (POST /api/gocode). Until then, show the
        // graduate-to-code path as pending rather than fabricating source.
        content.innerHTML = '<div class="explore-empty">Go code generation ships in Phase 4 ' +
            '(the <code>/api/gocode</code> endpoint). The JSON tab is the source of truth meanwhile.</div>';
    }

    private renderSqlTab(content: HTMLElement) {
        const w = this.state.widgets.find((x) => x.id === this.selectedId);
        if (!w) {
            content.innerHTML = '<div class="explore-empty">Select a widget to see its SQL / EXPLAIN.</div>';
            return;
        }
        const pre = document.createElement('pre');
        pre.className = 'explore-sql';
        pre.textContent = 'Loading…';
        content.appendChild(pre);
        const params = new URLSearchParams();
        params.append('filters', JSON.stringify(this.urlState.getCombinedFilter()));
        fetch(`${this.baseUrl}/api/preview/debug?${params.toString()}`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(this.envelope(w)),
        })
            .then((r) => r.ok ? r.json() : r.text().then((t) => { throw new Error(t); }))
            .then((info) => { pre.textContent = JSON.stringify(info, null, 2); })
            .catch((e) => { pre.textContent = `ERROR: ${e.message}`; });
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
