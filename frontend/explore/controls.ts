// controls.ts — the fixed set of form controls, one per editor kind
// (docs section 4.4). Each factory builds a plain DOM control that reads and
// writes a value on a target object and calls ctx.onChange() on every edit.
// The set is finite and stable; a new widget *option* needs no new control,
// only a genuinely new *type of value* would.
//
// SQL-ish inputs (whereClause / rawSql / the "expr" field mode) use
// <input>+<datalist> for column completion in this slice; CodeMirror is
// deferred to Phase 4 (see docs 4.4).

export interface Column { name: string; type: string; comment?: string; }
export interface SchemaResponse {
    commonColumns: string[];
    tables: string[];
    columns: Record<string, Column[]>;
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
    // The table currently selected in the query section, so field pickers can
    // offer that table's columns for autocomplete.
    getTable: () => string | null;
    onChange: () => void;
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

let datalistSeq = 0;
function columnDatalist(ctx: ControlCtx, timestampedOnly: boolean): HTMLDataListElement {
    const dl = el('datalist');
    dl.id = `explore-cols-${datalistSeq++}`;
    const table = ctx.getTable();
    const cols = (table && ctx.schema?.columns[table]) || [];
    for (const c of cols) {
        if (timestampedOnly && !/date|time/i.test(c.type)) continue;
        const opt = el('option');
        opt.value = c.name;
        opt.label = c.type;
        dl.appendChild(opt);
    }
    return dl;
}

// ---------------------------------------------------------------------------
// primitive controls
// ---------------------------------------------------------------------------

function textControl(field: FieldDescriptor, obj: any, ctx: ControlCtx): HTMLElement {
    const input = el('input', 'explore-input');
    input.type = 'text';
    input.value = obj[field.name] ?? '';
    input.addEventListener('input', () => { obj[field.name] = input.value; ctx.onChange(); });
    return input;
}

function intControl(field: FieldDescriptor, obj: any, ctx: ControlCtx): HTMLElement {
    const input = el('input', 'explore-input');
    input.type = 'number';
    const v = obj[field.name];
    input.value = v == null ? '' : String(v);
    input.addEventListener('input', () => {
        obj[field.name] = input.value === '' ? null : Number(input.value);
        ctx.onChange();
    });
    return input;
}

function boolControl(field: FieldDescriptor, obj: any, ctx: ControlCtx): HTMLElement {
    const input = el('input');
    input.type = 'checkbox';
    input.checked = !!obj[field.name];
    input.addEventListener('change', () => { obj[field.name] = input.checked; ctx.onChange(); });
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
    sel.addEventListener('change', () => { obj[field.name] = sel.value; ctx.onChange(); });
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
            input.addEventListener('input', () => { list[i] = input.value; ctx.onChange(); });
            const del = el('button', 'explore-btn explore-btn--icon', '×');
            del.type = 'button';
            del.addEventListener('click', () => { list.splice(i, 1); ctx.onChange(); redraw(); });
            row.appendChild(input);
            row.appendChild(del);
            container.appendChild(row);
        });
        const add = el('button', 'explore-btn explore-btn--sm', '+ add');
        add.type = 'button';
        add.addEventListener('click', () => { list.push(''); ctx.onChange(); redraw(); });
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
                ctx.onChange();
            };
            kIn.addEventListener('change', () => { commit(kIn.value); redraw(); });
            vIn.addEventListener('input', () => { map[kIn.value] = vIn.value; ctx.onChange(); });
            const del = el('button', 'explore-btn explore-btn--icon', '×');
            del.type = 'button';
            del.addEventListener('click', () => { delete map[k]; ctx.onChange(); redraw(); });
            row.append(kIn, vIn, del);
            container.appendChild(row);
        });
        const add = el('button', 'explore-btn explore-btn--sm', '+ add');
        add.type = 'button';
        add.addEventListener('click', () => { map[''] = ''; ctx.onChange(); redraw(); });
        container.appendChild(add);
    }
    redraw();
    return container;
}

// ---------------------------------------------------------------------------
// field picker (composite) — SqlField / TimestampedField
// ---------------------------------------------------------------------------

const FIELD_KINDS = ['autoBucket', 'count', 'enum', 'expr'];

function fieldControl(field: FieldDescriptor, obj: any, ctx: ControlCtx): HTMLElement {
    const container = el('div', 'explore-field-picker');

    function currentKind(): string {
        const v = obj[field.name];
        return v && typeof v === 'object' ? v.kind : '';
    }

    // Build the wire DTO for a chosen kind with sensible defaults, letting the
    // preview render immediately (see lib/dashboard/sql constructors).
    function seed(kind: string): any {
        switch (kind) {
            case 'autoBucket': return {kind, column: '', alias: 'time'};
            case 'count': return {kind, definition: 'count(*)', alias: 'count'};
            case 'enum': return {kind, definition: '', alias: ''};
            case 'expr': return {kind, definition: '', alias: ''};
            default: return null;
        }
    }

    function redraw() {
        container.innerHTML = '';
        const kindSel = el('select', 'explore-input');
        const kinds = field.required ? FIELD_KINDS : ['', ...FIELD_KINDS];
        for (const k of kinds) {
            const opt = el('option');
            opt.value = k;
            opt.textContent = k === '' ? '(none)' : k;
            kindSel.appendChild(opt);
        }
        kindSel.value = currentKind();
        kindSel.addEventListener('change', () => {
            obj[field.name] = seed(kindSel.value);
            ctx.onChange();
            redraw();
        });
        container.appendChild(kindSel);

        const v = obj[field.name];
        if (!v || typeof v !== 'object') return;

        if (v.kind === 'autoBucket') {
            const dl = columnDatalist(ctx, !!field.timestamped);
            container.appendChild(dl);
            const col = el('input', 'explore-input');
            col.placeholder = 'column';
            col.setAttribute('list', dl.id);
            col.value = v.column ?? '';
            col.addEventListener('input', () => { v.column = col.value; ctx.onChange(); });
            container.appendChild(col);
        } else if (v.kind === 'enum') {
            const dl = columnDatalist(ctx, false);
            container.appendChild(dl);
            const col = el('input', 'explore-input');
            col.placeholder = 'column';
            col.setAttribute('list', dl.id);
            // Present the underlying column; store the ::String cast expression.
            col.value = (v.definition ?? '').replace(/::String$/, '');
            col.addEventListener('input', () => {
                v.definition = col.value ? `${col.value}::String` : '';
                if (!v.alias) v.alias = col.value;
                ctx.onChange();
            });
            container.appendChild(col);
        } else if (v.kind === 'expr') {
            const dl = columnDatalist(ctx, false);
            container.appendChild(dl);
            const def = el('input', 'explore-input');
            def.placeholder = 'SQL expression';
            def.setAttribute('list', dl.id);
            def.value = v.definition ?? '';
            def.addEventListener('input', () => { v.definition = def.value; ctx.onChange(); });
            container.appendChild(def);
        }
        // count: no extra input besides alias.

        if (v.kind !== undefined) {
            const alias = el('input', 'explore-input');
            alias.placeholder = 'alias (column name in result)';
            alias.value = v.alias ?? '';
            alias.addEventListener('input', () => { v.alias = alias.value; ctx.onChange(); });
            container.appendChild(alias);
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
            ctx.onChange();
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
        legend.addEventListener('change', () => { cs.legend = legend.checked; ctx.onChange(); });
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
            valIn.addEventListener('input', () => { cs.domain[i] = valIn.value; ctx.onChange(); });
            const colIn = el('input');
            colIn.type = 'color';
            colIn.value = cs.range[i] || '#888888';
            colIn.addEventListener('input', () => { cs.range[i] = colIn.value; ctx.onChange(); });
            const del = el('button', 'explore-btn explore-btn--icon', '×');
            del.type = 'button';
            del.addEventListener('click', () => {
                cs.domain.splice(i, 1); cs.range.splice(i, 1); ctx.onChange(); redraw();
            });
            row.append(valIn, colIn, del);
            container.appendChild(row);
        });
        const add = el('button', 'explore-btn explore-btn--sm', '+ mapping');
        add.type = 'button';
        add.addEventListener('click', () => { cs.domain.push(''); cs.range.push('#888888'); ctx.onChange(); redraw(); });
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

export function makeQuerySection(props: any, ctx: ControlCtx): HTMLElement {
    if (props.query == null || typeof props.query !== 'object') {
        props.query = {kind: 'table', table: '', where: []};
    }
    const container = el('div', 'explore-query');
    container.appendChild(el('div', 'explore-section-title', 'Query'));

    function redraw() {
        const body = el('div');
        const q = props.query;

        const kindSel = el('select', 'explore-input');
        for (const k of ['table', 'raw']) {
            const opt = el('option');
            opt.value = k;
            opt.textContent = k === 'table' ? 'Table' : 'Raw SQL';
            kindSel.appendChild(opt);
        }
        kindSel.value = q.kind === 'raw' ? 'raw' : 'table';
        kindSel.addEventListener('change', () => {
            props.query = kindSel.value === 'raw'
                ? {kind: 'raw', sql: 'SELECT * FROM ... WHERE {{DASHICA_FILTERS}}'}
                : {kind: 'table', table: '', where: []};
            ctx.onChange();
            rebuild();
        });
        body.appendChild(labelled({name: 'source', editor: 'select'}, kindSel));

        if (q.kind === 'raw') {
            const ta = el('textarea', 'explore-input explore-textarea');
            ta.value = q.sql ?? '';
            ta.rows = 6;
            ta.addEventListener('input', () => { q.sql = ta.value; ctx.onChange(); });
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
            tbl.addEventListener('input', () => { q.table = tbl.value; ctx.onChange(); rebuild(); });
            body.append(dl, labelled({name: 'table', editor: 'text'}, tbl));

            // where clause list
            q.where = q.where ?? [];
            const whereWrap = el('div', 'explore-rowlist');
            const drawWhere = () => {
                whereWrap.innerHTML = '';
                (q.where as string[]).forEach((w, i) => {
                    const row = el('div', 'explore-row');
                    const cdl = columnDatalist(ctx, false);
                    const input = el('input', 'explore-input');
                    input.setAttribute('list', cdl.id);
                    input.placeholder = "e.g. level = 'error'";
                    input.value = w;
                    input.addEventListener('input', () => { q.where[i] = input.value; ctx.onChange(); });
                    const del = el('button', 'explore-btn explore-btn--icon', '×');
                    del.type = 'button';
                    del.addEventListener('click', () => { q.where.splice(i, 1); ctx.onChange(); drawWhere(); });
                    row.append(cdl, input, del);
                    whereWrap.appendChild(row);
                });
                const add = el('button', 'explore-btn explore-btn--sm', '+ WHERE');
                add.type = 'button';
                add.addEventListener('click', () => { q.where.push(''); ctx.onChange(); drawWhere(); });
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
