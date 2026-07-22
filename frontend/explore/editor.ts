// editor.ts — the Explore editor Alpine component. It owns the dashboard-in-
// progress (a client-side JSON model), loads the form model + schema, and wires
// the three panes (tree / preview / inspector) plus the bottom drawer.
//
// The dynamic UI is built imperatively in TypeScript rather than via Alpine
// directives, because the CSP Alpine build (@alpinejs/csp) forbids inline
// expressions. Alpine provides only the component lifecycle (init) and the
// shared urlState store (time range / filters) that drives preview re-queries.

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

export default () => ({
    baseUrl: '',
    formModel: null as FormModel | null,
    schema: null as SchemaResponse | null,
    state: {title: 'Untitled', layout: 'defaultPage', widgets: []} as DashboardState,
    selectedId: null as string | null,
    drawerTab: 'json' as 'gocode' | 'json' | 'sql',
    _idSeq: 0,
    _previews: {} as Record<string, PreviewController>,

    // pane containers (resolved from the templ shell in init)
    _elTree: null as HTMLElement | null,
    _elPreview: null as HTMLElement | null,
    _elInspector: null as HTMLElement | null,
    _elDrawer: null as HTMLElement | null,

    async init() {
        this.baseUrl = this.$el.dataset.baseUrl || '';
        this._elTree = this.$el.querySelector('[data-explore="tree"]');
        this._elPreview = this.$el.querySelector('[data-explore="preview"]');
        this._elInspector = this.$el.querySelector('[data-explore="inspector"]');
        this._elDrawer = this.$el.querySelector('[data-explore="drawer"]');

        this._loadState();

        const [fm, sc] = await Promise.all([
            fetch(`${this.baseUrl}/api/formmodel`).then((r) => r.json()),
            fetch(`${this.baseUrl}/api/schema`).then((r) => r.json()).catch(() => null),
        ]);
        this.formModel = fm;
        this.schema = sc;

        this._buildToolbar();
        this._renderTree();
        this._renderInspector();
        this._renderPreview();
        this._renderDrawer();

        // Re-query all previews when the time range / global filter changes.
        Alpine.effect(() => {
            this.$store.urlState.getCombinedFilter();
            JSON.stringify(this.$store.urlState.widgetParams);
            this._refreshAllPreviews();
        });
    },

    // ---- state persistence -------------------------------------------------

    _loadState() {
        const hash = new URLSearchParams(window.location.hash.slice(1)).get('s');
        if (hash) {
            try {
                this.state = JSON.parse(decodeURIComponent(escape(atob(hash))));
                this._reseedIdSeq();
                return;
            } catch { /* fall through */ }
        }
        const stored = localStorage.getItem(LS_KEY);
        if (stored) {
            try { this.state = JSON.parse(stored); this._reseedIdSeq(); return; } catch { /* ignore */ }
        }
    },

    _reseedIdSeq() {
        for (const w of this.state.widgets) {
            const n = parseInt((w.id || '').replace(/\D/g, ''), 10);
            if (!isNaN(n) && n >= this._idSeq) this._idSeq = n + 1;
        }
    },

    _save() {
        localStorage.setItem(LS_KEY, JSON.stringify(this.state));
    },

    _shareUrl(): string {
        const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(this.state))));
        return `${window.location.origin}${window.location.pathname}#s=${encoded}`;
    },

    // ---- toolbar -----------------------------------------------------------

    _buildToolbar() {
        const bar = this.$el.querySelector('[data-explore="toolbar"]') as HTMLElement;
        if (!bar) return;
        bar.innerHTML = '';

        const titleInput = document.createElement('input');
        titleInput.className = 'explore-input explore-toolbar__title';
        titleInput.value = this.state.title;
        titleInput.addEventListener('input', () => { this.state.title = titleInput.value; this._onChange(); });
        bar.appendChild(titleInput);

        const layoutSel = document.createElement('select');
        layoutSel.className = 'explore-input';
        for (const l of this.formModel?.layouts ?? []) {
            const o = document.createElement('option'); o.value = l; o.textContent = l; layoutSel.appendChild(o);
        }
        layoutSel.value = this.state.layout;
        layoutSel.addEventListener('change', () => { this.state.layout = layoutSel.value; this._onChange(); });
        bar.appendChild(layoutSel);

        const share = document.createElement('button');
        share.className = 'explore-btn';
        share.textContent = 'Copy share link';
        share.addEventListener('click', () => {
            navigator.clipboard.writeText(this._shareUrl());
            share.textContent = 'Copied!';
            setTimeout(() => { share.textContent = 'Copy share link'; }, 1500);
        });
        bar.appendChild(share);
    },

    // ---- tree --------------------------------------------------------------

    _renderTree() {
        const tree = this._elTree!;
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
        add.addEventListener('click', () => this._addWidget(sel.value));
        addRow.append(sel, add);
        tree.appendChild(addRow);

        const list = document.createElement('ul');
        list.className = 'explore-tree__list';
        this.state.widgets.forEach((w, i) => {
            const li = document.createElement('li');
            li.className = 'explore-tree__item' + (w.id === this.selectedId ? ' is-selected' : '');
            const name = document.createElement('span');
            name.className = 'explore-tree__name';
            name.textContent = `${this.formModel?.widgets[w.type]?.title ?? w.type}`;
            name.addEventListener('click', () => this._select(w.id));
            li.appendChild(name);

            const up = document.createElement('button');
            up.className = 'explore-btn explore-btn--icon';
            up.textContent = '↑';
            up.disabled = i === 0;
            up.addEventListener('click', () => this._move(i, -1));
            const down = document.createElement('button');
            down.className = 'explore-btn explore-btn--icon';
            down.textContent = '↓';
            down.disabled = i === this.state.widgets.length - 1;
            down.addEventListener('click', () => this._move(i, 1));
            const del = document.createElement('button');
            del.className = 'explore-btn explore-btn--icon';
            del.textContent = '×';
            del.addEventListener('click', () => this._delete(w.id));
            li.append(up, down, del);
            list.appendChild(li);
        });
        tree.appendChild(list);
    },

    _addWidget(type: string) {
        if (!type || !this.formModel?.widgets[type]) return;
        const w: WidgetState = {
            id: `w${this._idSeq++}`,
            type,
            props: deepClone(this.formModel.widgets[type].defaults),
        };
        this.state.widgets.push(w);
        this.selectedId = w.id;
        this._onChange();
        this._renderTree();
        this._renderInspector();
        this._renderPreview();
    },

    _delete(id: string) {
        this.state.widgets = this.state.widgets.filter((w) => w.id !== id);
        if (this.selectedId === id) this.selectedId = null;
        this._previews[id]?.destroy();
        delete this._previews[id];
        this._onChange();
        this._renderTree();
        this._renderInspector();
        this._renderPreview();
    },

    _move(index: number, dir: number) {
        const j = index + dir;
        if (j < 0 || j >= this.state.widgets.length) return;
        const arr = this.state.widgets;
        [arr[index], arr[j]] = [arr[j], arr[index]];
        this._onChange();
        this._renderTree();
        this._renderPreview();
    },

    _select(id: string) {
        this.selectedId = id;
        this._renderTree();
        this._renderInspector();
    },

    // ---- inspector ---------------------------------------------------------

    _renderInspector() {
        const insp = this._elInspector!;
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

        const ctx: ControlCtx = {
            baseUrl: this.baseUrl,
            schema: this.schema,
            getTable: () => (w.props.query && w.props.query.kind === 'table' ? w.props.query.table : null),
            onChange: debounce(() => {
                this._onChange();
                this._refreshPreview(w.id);
                this._renderDrawer();
            }),
        };
        const form = document.createElement('div');
        renderForm(form, descriptor, w.props, ctx);
        insp.appendChild(form);
    },

    // ---- preview -----------------------------------------------------------

    _renderPreview() {
        const pv = this._elPreview!;
        // Destroy controllers for widgets that no longer exist.
        for (const id of Object.keys(this._previews)) {
            if (!this.state.widgets.some((w) => w.id === id)) {
                this._previews[id].destroy();
                delete this._previews[id];
            }
        }
        pv.innerHTML = '';
        if (this.state.widgets.length === 0) {
            pv.innerHTML = '<div class="explore-empty">Add a widget to start building.</div>';
            return;
        }
        for (const w of this.state.widgets) {
            const card = document.createElement('div');
            card.className = 'explore-card' + (w.id === this.selectedId ? ' is-selected' : '');
            card.addEventListener('click', () => this._select(w.id));
            const body = document.createElement('div');
            body.className = 'explore-card__body';
            card.appendChild(body);
            pv.appendChild(card);

            this._previews[w.id] = mountPreview(body, this.baseUrl);
            this._refreshPreview(w.id);
        }
    },

    _refreshPreview(id: string) {
        const w = this.state.widgets.find((x) => x.id === id);
        const ctrl = this._previews[id];
        if (!w || !ctrl) return;
        const envelope: WidgetEnvelope = {type: w.type, props: w.props};
        ctrl.render(envelope, this.$store.urlState.getCombinedFilter(), this.$store.urlState.widgetParams);
    },

    _refreshAllPreviews() {
        for (const w of this.state.widgets) this._refreshPreview(w.id);
    },

    // ---- drawer (Go code / JSON / SQL) ------------------------------------

    _renderDrawer() {
        const drawer = this._elDrawer!;
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
            b.addEventListener('click', () => { this.drawerTab = key; this._renderDrawer(); });
            tabs.appendChild(b);
        }
        drawer.appendChild(tabs);

        const content = document.createElement('div');
        content.className = 'explore-drawer__content';
        drawer.appendChild(content);

        if (this.drawerTab === 'json') this._renderJsonTab(content);
        else if (this.drawerTab === 'gocode') this._renderGocodeTab(content);
        else this._renderSqlTab(content);
    },

    _renderJsonTab(content: HTMLElement) {
        const ta = document.createElement('textarea');
        ta.className = 'explore-input explore-textarea explore-json';
        ta.spellcheck = false;
        ta.value = JSON.stringify(this.state, null, 2);
        const status = document.createElement('div');
        status.className = 'explore-json__status';
        ta.addEventListener('input', () => {
            try {
                const parsed = JSON.parse(ta.value);
                this.state = parsed;
                this._reseedIdSeq();
                status.textContent = 'valid — applied';
                status.className = 'explore-json__status is-ok';
                this._save();
                this._buildToolbar();
                this._renderTree();
                this._renderInspector();
                this._renderPreview();
            } catch (e: any) {
                status.textContent = e.message;
                status.className = 'explore-json__status is-err';
            }
        });
        content.append(ta, status);
    },

    _renderGocodeTab(content: HTMLElement) {
        // Go code generation is Phase 4 (POST /api/gocode). Until then, show the
        // graduate-to-code path as pending rather than fabricating source.
        content.innerHTML = '<div class="explore-empty">Go code generation ships in Phase 4 ' +
            '(the <code>/api/gocode</code> endpoint). The JSON tab is the source of truth meanwhile.</div>';
    },

    _renderSqlTab(content: HTMLElement) {
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
        params.append('filters', JSON.stringify(this.$store.urlState.getCombinedFilter()));
        fetch(`${this.baseUrl}/api/preview/debug?${params.toString()}`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({type: w.type, props: w.props}),
        })
            .then((r) => r.ok ? r.json() : r.text().then((t) => { throw new Error(t); }))
            .then((info) => { pre.textContent = JSON.stringify(info, null, 2); })
            .catch((e) => { pre.textContent = `ERROR: ${e.message}`; });
    },

    // ---- change plumbing ---------------------------------------------------

    _onChange() {
        this._save();
    },
});
