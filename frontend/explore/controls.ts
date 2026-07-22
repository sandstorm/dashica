// controls.ts — the fixed set of form controls, one per editor kind
// (docs section 4.4). Each factory builds a plain DOM control that reads and
// writes a value on a *reactive* target object (the widget's props proxy).
// There is no onChange callback: a write into the reactive props is itself the
// notification — the editor's per-widget preview effect and persist effect
// react to it (see docs §"reactive dataflow"). The set is finite and stable; a
// new widget *option* needs no new control, only a genuinely new *type of
// value* would.
//
// The field pickers teach *intent*, not the serializer vocabulary (docs UX plan
// (3)): kind labels ("Time bucket (automatic)", "Row count", …) and per-slot
// column classes (temporal / categorical / continuous) come from the formmodel
// so Go stays the source of truth. Column pickers are slot-aware — the
// preferred class is offered first, wrong-class columns are demoted (not
// hidden) and badged.
//
// SQL-ish inputs (whereClause / rawSql / the "expr" field mode) use
// <input>+<datalist> for column completion in this slice; CodeMirror is
// deferred to Phase 4 (see docs 4.4).

export type ColumnClass = 'temporal' | 'categorical' | 'continuous' | '';

export interface Column { name: string; type: string; comment?: string; class?: ColumnClass; }
export interface SchemaResponse {
    commonColumns: string[];
    tables: string[];
    columns: Record<string, Column[]>;
}

// FieldKind mirrors lib/explore/formmodel.go fieldKind — the intent vocabulary
// of a field picker. Labels + slot metadata are served by the backend.
export interface FieldKind {
    kind: string;
    label: string;
    requiresColumn?: boolean;
    columnClass?: ColumnClass;
    advanced?: boolean;
}

// FieldDescriptor mirrors lib/dashboard/widget/formmodel.go FieldDescriptor.
export interface FieldDescriptor {
    name: string;
    editor: string;
    required?: boolean;
    timestamped?: boolean;
    help?: string;
    options?: string[];
    fields?: FieldDescriptor[];
}

export interface ControlCtx {
    baseUrl: string;
    schema: SchemaResponse | null;
    // The intent vocabulary for field pickers (from the formmodel).
    fieldKinds: FieldKind[];
    // The table currently selected in the query section, so field pickers can
    // offer that table's columns for autocomplete.
    getTable: () => string | null;
    // Golden path: called by the query section when a table is chosen, so the
    // form can seed required-but-empty field pickers and rebuild the options
    // section (set by the form renderer). See docs UX plan (3).
    onTableChosen?: (table: string) => void;
}

// The class → badge glyph the editor shows wherever a column appears (pickers,
// Data-tab list, WHERE completion). Tooltip carries the class word.
export const CLASS_BADGE: Record<string, string> = {
    temporal: '⏱',
    categorical: '🏷',
    continuous: '#',
};

export function classBadge(cls?: string): string {
    return (cls && CLASS_BADGE[cls]) || '';
}

// ---------------------------------------------------------------------------
// small DOM helpers
// ---------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
}

function labelled(field: FieldDescriptor, control: HTMLElement): HTMLElement {
    const wrap = el('div', 'explore-field');
    const label = el('label', 'explore-field__label', humanize(field.name));
    if (field.required) label.appendChild(el('span', 'explore-field__req', ' *'));
    wrap.appendChild(label);
    if (field.help) {
        const help = el('div', 'explore-field__help', field.help);
        wrap.appendChild(help);
    }
    wrap.appendChild(control);
    return wrap;
}

function humanize(name: string): string {
    return name.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim();
}

// ---------------------------------------------------------------------------
// column-reference click-to-insert plumbing
// ---------------------------------------------------------------------------

// The most-recently-focused SQL-ish input (a WHERE clause or a custom
// expression). The query section's collapsible "Columns" reference inserts a
// column name here on click — a lightweight value picker that needs no
// selection state beyond "where was the cursor last".
let lastSqlInput: HTMLInputElement | HTMLTextAreaElement | null = null;

function trackSqlFocus(input: HTMLInputElement | HTMLTextAreaElement) {
    input.addEventListener('focus', () => { lastSqlInput = input; });
}

function insertIntoLastSqlInput(text: string) {
    const input = lastSqlInput;
    if (!input || !input.isConnected) return;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    input.value = input.value.slice(0, start) + text + input.value.slice(end);
    const caret = start + text.length;
    input.setSelectionRange(caret, caret);
    input.focus();
    // Fire input so the reactive write in the control's listener runs.
    input.dispatchEvent(new Event('input', {bubbles: true}));
}

// ---------------------------------------------------------------------------
// class-aware column completion
// ---------------------------------------------------------------------------

let datalistSeq = 0;
// Wire an <input> to a column-name datalist that (re)populates on focus, so its
// options are always a derived view of the *current* table — even after the
// table is switched without rebuilding the form. This is what makes the
// stale-datalist bug impossible by construction (populating on focus, not once
// at build time, also avoids ever rebuilding the input and stealing focus).
//
// Slot-aware: when `preferred` is a column class, matching columns sort first
// and every option's label carries a class badge + type, so the picker teaches
// which columns fit the slot without hiding the escape hatches (docs UX plan
// (3)). Returns the datalist so the caller can append it near the input.
function attachColumnCompletion(input: HTMLInputElement, ctx: ControlCtx, preferred: ColumnClass | null): HTMLDataListElement {
    trackSqlFocus(input);
    const dl = el('datalist');
    dl.id = `explore-cols-${datalistSeq++}`;
    input.setAttribute('list', dl.id);
    const populate = () => {
        dl.innerHTML = '';
        const table = ctx.getTable();
        const cols = (table && ctx.schema?.columns[table]) || [];
        const ordered = preferred
            ? [...cols].sort((a, b) => Number(b.class === preferred) - Number(a.class === preferred))
            : cols;
        for (const c of ordered) {
            const opt = el('option');
            opt.value = c.name;
            const badge = classBadge(c.class);
            opt.label = badge ? `${badge} ${c.type}` : c.type;
            dl.appendChild(opt);
        }
    };
    input.addEventListener('focus', populate);
    populate();
    return dl;
}

// ---------------------------------------------------------------------------
// primitive controls
// ---------------------------------------------------------------------------

function textControl(field: FieldDescriptor, obj: any, ctx: ControlCtx): HTMLElement {
    const input = el('input', 'explore-input');
    input.type = 'text';
    input.value = obj[field.name] ?? '';
    input.addEventListener('input', () => { obj[field.name] = input.value; });
    return input;
}

function intControl(field: FieldDescriptor, obj: any, ctx: ControlCtx): HTMLElement {
    const input = el('input', 'explore-input');
    input.type = 'number';
    const v = obj[field.name];
    input.value = v == null ? '' : String(v);
    input.addEventListener('input', () => {
        obj[field.name] = input.value === '' ? null : Number(input.value);
    });
    return input;
}

function boolControl(field: FieldDescriptor, obj: any, ctx: ControlCtx): HTMLElement {
    const input = el('input');
    input.type = 'checkbox';
    input.checked = !!obj[field.name];
    input.addEventListener('change', () => { obj[field.name] = input.checked; });
    const wrap = el('div', 'explore-inline');
    wrap.appendChild(input);
    return wrap;
}

function selectControl(field: FieldDescriptor, obj: any, ctx: ControlCtx): HTMLElement {
    const sel = el('select', 'explore-input');
    // Enum zero value is the empty string (Plot default) — offer it explicitly.
    const opts = ['', ...(field.options ?? [])];
    for (const o of opts) {
        const opt = el('option');
        opt.value = o;
        opt.textContent = o === '' ? '(default)' : o;
        sel.appendChild(opt);
    }
    sel.value = obj[field.name] ?? '';
    sel.addEventListener('change', () => { obj[field.name] = sel.value; });
    return sel;
}

function stringListControl(field: FieldDescriptor, obj: any, ctx: ControlCtx): HTMLElement {
    if (!Array.isArray(obj[field.name])) obj[field.name] = obj[field.name] ?? [];
    const list: string[] = obj[field.name];
    const container = el('div', 'explore-rowlist');

    function redraw() {
        container.innerHTML = '';
        list.forEach((val, i) => {
            const row = el('div', 'explore-row');
            const input = el('input', 'explore-input');
            input.value = val;
            input.addEventListener('input', () => { list[i] = input.value; });
            const del = el('button', 'explore-btn explore-btn--icon', '×');
            del.type = 'button';
            del.addEventListener('click', () => { list.splice(i, 1); redraw(); });
            row.appendChild(input);
            row.appendChild(del);
            container.appendChild(row);
        });
        const add = el('button', 'explore-btn explore-btn--sm', '+ add');
        add.type = 'button';
        add.addEventListener('click', () => { list.push(''); redraw(); });
        container.appendChild(add);
    }
    redraw();
    return container;
}

function keyValueControl(field: FieldDescriptor, obj: any, ctx: ControlCtx): HTMLElement {
    if (obj[field.name] == null || typeof obj[field.name] !== 'object') obj[field.name] = obj[field.name] ?? {};
    const map: Record<string, string> = obj[field.name];
    const container = el('div', 'explore-rowlist');

    function redraw() {
        container.innerHTML = '';
        Object.entries(map).forEach(([k, v]) => {
            const row = el('div', 'explore-row');
            const kIn = el('input', 'explore-input');
            kIn.placeholder = 'key';
            kIn.value = k;
            const vIn = el('input', 'explore-input');
            vIn.placeholder = 'value';
            vIn.value = v;
            const commit = (newK: string) => {
                delete map[k];
                map[newK] = vIn.value;
            };
            kIn.addEventListener('change', () => { commit(kIn.value); redraw(); });
            vIn.addEventListener('input', () => { map[kIn.value] = vIn.value; });
            const del = el('button', 'explore-btn explore-btn--icon', '×');
            del.type = 'button';
            del.addEventListener('click', () => { delete map[k]; redraw(); });
            row.append(kIn, vIn, del);
            container.appendChild(row);
        });
        const add = el('button', 'explore-btn explore-btn--sm', '+ add');
        add.type = 'button';
        add.addEventListener('click', () => { map[''] = ''; redraw(); });
        container.appendChild(add);
    }
    redraw();
    return container;
}

// ---------------------------------------------------------------------------
// field picker (composite) — SqlField / TimestampedField
// ---------------------------------------------------------------------------

// The wire "kinds" that apply to a slot. autoBucket only makes sense on a
// timestamped axis (it buckets a DateTime column); a plain value/measure field
// is count / enum / custom. (This slot rule is structural — the labels and
// column classes come from the served fieldKinds.)
function kindsForSlot(field: FieldDescriptor): string[] {
    return field.timestamped ? ['autoBucket', 'expr'] : ['count', 'enum', 'expr'];
}

// Build the wire DTO for a chosen kind with sensible defaults, letting the
// preview render immediately (see lib/dashboard/sql constructors).
function seedKind(kind: string): any {
    switch (kind) {
        case 'autoBucket': return {kind, column: '', alias: 'time'};
        case 'count': return {kind, definition: 'count(*)', alias: 'count'};
        case 'enum': return {kind, definition: '', alias: ''};
        case 'expr': return {kind, definition: '', alias: ''};
        default: return null;
    }
}

function fieldControl(field: FieldDescriptor, obj: any, ctx: ControlCtx): HTMLElement {
    const container = el('div', 'explore-field-picker');

    const slotKinds = kindsForSlot(field);
    const info = (k: string): FieldKind =>
        ctx.fieldKinds.find((f) => f.kind === k) ?? {kind: k, label: k};
    const defaultKind = slotKinds.find((k) => !info(k).advanced) ?? slotKinds[0];

    function currentKind(): string {
        const v = obj[field.name];
        return v && typeof v === 'object' ? v.kind : '';
    }

    // A required field always has a sensible default kind selected so its intent
    // is visible before a column is picked (Y shows "Row count", X shows "Time
    // bucket"). Optional fields keep "(none)".
    if (field.required && !currentKind()) obj[field.name] = seedKind(defaultKind);

    // Advanced reveals the custom-expression kind + the alias input. It starts
    // on when the current value already uses them, so nothing is ever hidden.
    let advanced = (() => {
        const v = obj[field.name];
        return !!(v && typeof v === 'object' && (info(v.kind).advanced || v.alias));
    })();

    function redraw() {
        container.innerHTML = '';

        // kind dropdown — human labels, advanced kinds gated by the toggle.
        const kindSel = el('select', 'explore-input');
        const shown = advanced ? slotKinds : slotKinds.filter((k) => !info(k).advanced);
        const opts = field.required ? shown : ['', ...shown];
        for (const k of opts) {
            const opt = el('option');
            opt.value = k;
            opt.textContent = k === '' ? '(none)' : info(k).label;
            kindSel.appendChild(opt);
        }
        kindSel.value = currentKind();
        kindSel.addEventListener('change', () => {
            obj[field.name] = seedKind(kindSel.value);
            redraw();
        });
        container.appendChild(kindSel);

        const v = obj[field.name];
        if (v && typeof v === 'object') {
            const preferred = (info(v.kind).columnClass ?? '') as ColumnClass;

            if (v.kind === 'autoBucket') {
                const col = el('input', 'explore-input');
                col.placeholder = 'column';
                col.value = v.column ?? '';
                col.addEventListener('input', () => { v.column = col.value; });
                container.append(attachColumnCompletion(col, ctx, preferred || 'temporal'), col);
            } else if (v.kind === 'enum') {
                const col = el('input', 'explore-input');
                col.placeholder = 'column';
                // Present the underlying column; store the ::String cast expression.
                col.value = (v.definition ?? '').replace(/::String$/, '');
                col.addEventListener('input', () => {
                    v.definition = col.value ? `${col.value}::String` : '';
                    if (!v.alias) v.alias = col.value;
                });
                container.append(attachColumnCompletion(col, ctx, preferred || 'categorical'), col);
            } else if (v.kind === 'expr') {
                const def = el('input', 'explore-input');
                def.placeholder = 'SQL expression';
                def.value = v.definition ?? '';
                def.addEventListener('input', () => { v.definition = def.value; });
                container.append(attachColumnCompletion(def, ctx, null), def);
            }
            // count: no extra input besides the (advanced) alias.

            if (advanced) {
                const alias = el('input', 'explore-input');
                alias.placeholder = 'alias (column name in result)';
                alias.value = v.alias ?? '';
                alias.addEventListener('input', () => { v.alias = alias.value; });
                container.appendChild(alias);
            }
        }

        // advanced toggle — only shown when there is anything advanced to reveal
        // (a custom-expression kind, or the alias input on a chosen kind).
        const hasAdvancedKind = slotKinds.some((k) => info(k).advanced);
        if (hasAdvancedKind || (v && typeof v === 'object')) {
            const adv = el('label', 'explore-advanced-toggle');
            const cb = el('input');
            cb.type = 'checkbox';
            cb.checked = advanced;
            cb.addEventListener('change', () => { advanced = cb.checked; redraw(); });
            adv.append(cb, el('span', undefined, 'Advanced (custom expression, alias)'));
            container.appendChild(adv);
        }
    }
    redraw();
    return container;
}

// ---------------------------------------------------------------------------
// colorScale — legend + unknown + scheme + domain/range rows
// ---------------------------------------------------------------------------

function colorScaleControl(field: FieldDescriptor, obj: any, ctx: ControlCtx): HTMLElement {
    const container = el('div', 'explore-colorscale');

    function redraw() {
        container.innerHTML = '';
        const enabled = obj[field.name] != null && typeof obj[field.name] === 'object';

        const toggleRow = el('div', 'explore-inline');
        const toggle = el('input');
        toggle.type = 'checkbox';
        toggle.checked = enabled;
        toggle.addEventListener('change', () => {
            obj[field.name] = toggle.checked ? {legend: false, domain: [], range: [], unknown: '#8E44AD'} : null;
            redraw();
        });
        toggleRow.append(toggle, el('span', undefined, 'custom color scale'));
        container.appendChild(toggleRow);
        if (!enabled) return;

        const cs = obj[field.name];

        const legendRow = el('div', 'explore-inline');
        const legend = el('input');
        legend.type = 'checkbox';
        legend.checked = !!cs.legend;
        legend.addEventListener('change', () => { cs.legend = legend.checked; });
        legendRow.append(legend, el('span', undefined, 'show legend'));
        container.appendChild(legendRow);

        // value -> color mappings (domain[i] -> range[i])
        cs.domain = cs.domain ?? [];
        cs.range = cs.range ?? [];
        cs.domain.forEach((dv: string, i: number) => {
            const row = el('div', 'explore-row');
            const valIn = el('input', 'explore-input');
            valIn.placeholder = 'value';
            valIn.value = dv;
            valIn.addEventListener('input', () => { cs.domain[i] = valIn.value; });
            const colIn = el('input');
            colIn.type = 'color';
            colIn.value = cs.range[i] || '#888888';
            colIn.addEventListener('input', () => { cs.range[i] = colIn.value; });
            const del = el('button', 'explore-btn explore-btn--icon', '×');
            del.type = 'button';
            del.addEventListener('click', () => {
                cs.domain.splice(i, 1); cs.range.splice(i, 1); redraw();
            });
            row.append(valIn, colIn, del);
            container.appendChild(row);
        });
        const add = el('button', 'explore-btn explore-btn--sm', '+ mapping');
        add.type = 'button';
        add.addEventListener('click', () => { cs.domain.push(''); cs.range.push('#888888'); redraw(); });
        container.appendChild(add);
    }
    redraw();
    return container;
}

// ---------------------------------------------------------------------------
// group — nested sub-fields
// ---------------------------------------------------------------------------

function groupControl(field: FieldDescriptor, obj: any, ctx: ControlCtx): HTMLElement {
    if (obj[field.name] == null || typeof obj[field.name] !== 'object') obj[field.name] = obj[field.name] ?? {};
    const inner = obj[field.name];
    const container = el('div', 'explore-group');
    for (const sub of field.fields ?? []) {
        container.appendChild(makeControl(sub, inner, ctx));
    }
    return container;
}

// ---------------------------------------------------------------------------
// query section — SqlQueryable envelope (table | file | raw)
// ---------------------------------------------------------------------------

export function makeQuerySection(props: any, queryKey: string, ctx: ControlCtx): HTMLElement {
    if (props[queryKey] == null || typeof props[queryKey] !== 'object') {
        props[queryKey] = {kind: 'table', table: '', where: []};
    }
    const container = el('div', 'explore-query');
    container.appendChild(el('div', 'explore-section-title', 'Query'));

    // Only the source *kind* switch rebuilds the body (it swaps which inputs
    // exist). Individual inputs mutate in place and never re-render, so typing
    // in the table / where fields never loses focus.
    function redraw() {
        const body = el('div');
        const q = props[queryKey];

        const kindSel = el('select', 'explore-input');
        for (const k of ['table', 'raw']) {
            const opt = el('option');
            opt.value = k;
            opt.textContent = k === 'table' ? 'Table' : 'Raw SQL';
            kindSel.appendChild(opt);
        }
        kindSel.value = q.kind === 'raw' ? 'raw' : 'table';
        kindSel.addEventListener('change', () => {
            props[queryKey] = kindSel.value === 'raw'
                ? {kind: 'raw', sql: 'SELECT * FROM ... WHERE {{DASHICA_FILTERS}}'}
                : {kind: 'table', table: '', where: []};
            rebuild();
        });
        body.appendChild(labelled({name: 'source', editor: 'select'}, kindSel));

        if (q.kind === 'raw') {
            const ta = el('textarea', 'explore-input explore-textarea');
            ta.value = q.sql ?? '';
            ta.rows = 6;
            trackSqlFocus(ta);
            ta.addEventListener('input', () => { q.sql = ta.value; });
            body.appendChild(labelled({name: 'sql', editor: 'rawSql', help: 'Must contain {{DASHICA_FILTERS}}.'}, ta));
        } else {
            const dl = el('datalist');
            dl.id = `explore-tables-${datalistSeq++}`;
            for (const t of ctx.schema?.tables ?? []) {
                const opt = el('option'); opt.value = t; dl.appendChild(opt);
            }
            const tbl = el('input', 'explore-input');
            tbl.setAttribute('list', dl.id);
            tbl.value = q.table ?? '';
            // No re-render on input — just mutate, so focus is kept while typing.
            // Chosen a table? let the form seed required-but-empty pickers so
            // "pick a table = a rendering chart" (docs UX plan (3)). The seeder
            // rebuilds only the options section, never this focused input.
            tbl.addEventListener('input', () => {
                q.table = tbl.value;
                if (tbl.value && ctx.onTableChosen) ctx.onTableChosen(tbl.value);
            });
            body.append(dl, labelled({name: 'table', editor: 'text'}, tbl));

            // collapsible column reference for the chosen table — badge + name +
            // type; clicking a column inserts its name into the last-focused
            // WHERE / expression input (docs UX plan (2)).
            body.appendChild(columnReference(ctx));

            // where clause list
            q.where = q.where ?? [];
            const whereWrap = el('div', 'explore-rowlist');
            const drawWhere = () => {
                whereWrap.innerHTML = '';
                (q.where as string[]).forEach((w, i) => {
                    const row = el('div', 'explore-row');
                    const input = el('input', 'explore-input');
                    input.placeholder = "e.g. level = 'error'";
                    input.value = w;
                    input.addEventListener('input', () => { q.where[i] = input.value; });
                    const cdl = attachColumnCompletion(input, ctx, null);
                    const del = el('button', 'explore-btn explore-btn--icon', '×');
                    del.type = 'button';
                    del.addEventListener('click', () => { q.where.splice(i, 1); drawWhere(); });
                    row.append(cdl, input, del);
                    whereWrap.appendChild(row);
                });
                const add = el('button', 'explore-btn explore-btn--sm', '+ WHERE');
                add.type = 'button';
                add.addEventListener('click', () => { q.where.push(''); drawWhere(); });
                whereWrap.appendChild(add);
            };
            drawWhere();
            body.appendChild(labelled({name: 'where', editor: 'whereClause'}, whereWrap));
        }
        return body;
    }

    let current: HTMLElement;
    function rebuild() {
        const next = redraw();
        if (current) current.replaceWith(next); else container.appendChild(next);
        current = next;
    }
    rebuild();
    return container;
}

// columnReference is the collapsible list of the current table's columns, shown
// under the table input. Repopulates each time it is opened, so it always
// reflects the current table. Clicking a column inserts its name at the cursor
// in the last-focused WHERE / expression input.
function columnReference(ctx: ControlCtx): HTMLElement {
    const details = el('details', 'explore-colref');
    const summary = el('summary', undefined, 'Columns');
    details.appendChild(summary);
    const list = el('div', 'explore-colref__list');
    details.appendChild(list);

    const populate = () => {
        list.innerHTML = '';
        const table = ctx.getTable();
        const cols = (table && ctx.schema?.columns[table]) || [];
        if (cols.length === 0) {
            list.appendChild(el('div', 'explore-field__help', table ? 'No columns.' : 'Pick a table first.'));
            return;
        }
        for (const c of cols) {
            const row = el('button', 'explore-colref__col');
            row.type = 'button';
            row.title = `${c.type}${c.comment ? ` — ${c.comment}` : ''} (click to insert)`;
            const badge = classBadge(c.class);
            if (badge) row.appendChild(el('span', 'explore-badge', badge));
            row.appendChild(el('span', 'explore-colref__name', c.name));
            row.appendChild(el('span', 'explore-colref__type', c.type));
            row.addEventListener('click', () => insertIntoLastSqlInput(c.name));
            list.appendChild(row);
        }
    };
    details.addEventListener('toggle', () => { if (details.open) populate(); });
    return details;
}

// ---------------------------------------------------------------------------
// golden-path seeding (called by the form renderer on table selection)
// ---------------------------------------------------------------------------

// seedRequiredFields fills required-but-empty field pickers when a table is
// chosen, so a freshly added widget renders immediately: the timestamped X gets
// an auto-bucket on the first temporal column, a value field (Y) gets a row
// count. Never clobbers a value the user already set. Returns whether anything
// changed (so the caller can skip a needless rebuild).
export function seedRequiredFields(fields: FieldDescriptor[], props: any, ctx: ControlCtx, table: string): boolean {
    const cols = (ctx.schema?.columns[table]) || [];
    const firstOfClass = (cls: ColumnClass) => cols.find((c) => c.class === cls)?.name;
    let changed = false;

    for (const f of fields) {
        if (f.editor !== 'field' || !f.required) continue;
        const v = props[f.name];

        if (f.timestamped) {
            const col = firstOfClass('temporal');
            if (!v || typeof v !== 'object' || v.kind !== 'autoBucket') {
                props[f.name] = {kind: 'autoBucket', column: col ?? '', alias: 'time'};
                changed = true;
            } else if (!v.column && col) {
                v.column = col;
                changed = true;
            }
        } else if (!v || typeof v !== 'object' || !v.kind) {
            // A value field with nothing chosen defaults to row count (renders
            // without needing a column).
            props[f.name] = seedKind('count');
            changed = true;
        }
    }
    return changed;
}

// ---------------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------------

export function makeControl(field: FieldDescriptor, obj: any, ctx: ControlCtx): HTMLElement {
    switch (field.editor) {
        case 'text': return labelled(field, textControl(field, obj, ctx));
        case 'int': return labelled(field, intControl(field, obj, ctx));
        case 'bool': return labelled(field, boolControl(field, obj, ctx));
        case 'select': return labelled(field, selectControl(field, obj, ctx));
        case 'field': return labelled(field, fieldControl(field, obj, ctx));
        case 'colorScale': return labelled(field, colorScaleControl(field, obj, ctx));
        case 'keyValue': return labelled(field, keyValueControl(field, obj, ctx));
        case 'stringList': return labelled(field, stringListControl(field, obj, ctx));
        case 'group': return labelled(field, groupControl(field, obj, ctx));
        case 'children': {
            const note = el('div', 'explore-field__help', 'Nested widgets (grid/group) are edited in a later phase.');
            return labelled(field, note);
        }
        default: {
            const note = el('div', 'explore-field__help', `Unsupported editor: ${field.editor}`);
            return labelled(field, note);
        }
    }
}
