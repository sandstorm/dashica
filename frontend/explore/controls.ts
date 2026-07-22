// controls.ts — the fixed set of form controls, one per editor kind
// (docs section 4.4). Each factory builds a plain DOM control that reads and
// writes a value on a *reactive* target object (the widget's props proxy).
// There is no onChange callback: a write into the reactive props is itself the
// notification — the editor's per-widget preview effect and persist effect
// react to it (see docs §"reactive dataflow"). The set is finite and stable; a
// new widget *option* needs no new control, only a genuinely new *type of
// value* would.
//
// DOM is assembled with htl's `html` tag (the same one chart/table.ts uses):
// structure + one-shot event handlers (`oninput=${…}` becomes a property
// listener) live in the template; the returned node is captured in a `const`
// the handler closes over. Where a value depends on children already existing
// (a <select>'s `.value`, a checkbox's `.checked`) or where an element needs a
// *second* listener beyond what htl assigns (column completion adds a `focus`
// listener via addEventListener), that is set imperatively after the build.
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

import {html} from "htl";

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
    // Slot roles this kind serves ('dimension' | 'measure'). A picker offers a
    // kind only when the slot's role is listed here (B4).
    roles?: string[];
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
    // Query role of the slot ('dimension' | 'measure'), from the Go struct tag.
    // Drives which field kinds the picker offers (B4).
    role?: string;
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

function labelled(field: FieldDescriptor, control: HTMLElement): HTMLElement {
    return html`<div class="explore-field">
        <label class="explore-field__label">${humanize(field.name)}${
            field.required ? html`<span class="explore-field__req"> *</span>` : ''}</label>
        ${field.help ? html`<div class="explore-field__help">${field.help}</div>` : ''}
        ${control}
    </div>` as HTMLElement;
}

export function humanize(name: string): string {
    return name.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim();
}

// A "× remove" / "+ add" style button — the recurring row-list affordance.
function iconButton(label: string, onClick: () => void): HTMLButtonElement {
    return html`<button type="button" class="explore-btn explore-btn--icon" onclick=${onClick}>${label}</button>` as HTMLButtonElement;
}

function addButton(label: string, onClick: () => void): HTMLButtonElement {
    return html`<button type="button" class="explore-btn explore-btn--sm" onclick=${onClick}>${label}</button>` as HTMLButtonElement;
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
    const id = `explore-cols-${datalistSeq++}`;
    const dl = html`<datalist id=${id}></datalist>` as HTMLDataListElement;
    input.setAttribute('list', id);
    const populate = () => {
        const table = ctx.getTable();
        const cols = (table && ctx.schema?.columns[table]) || [];
        const ordered = preferred
            ? [...cols].sort((a, b) => Number(b.class === preferred) - Number(a.class === preferred))
            : cols;
        dl.replaceChildren(...ordered.map((c) => {
            const badge = classBadge(c.class);
            return html`<option value=${c.name} label=${badge ? `${badge} ${c.type}` : c.type}></option>`;
        }));
    };
    input.addEventListener('focus', populate);
    populate();
    return dl;
}

// ---------------------------------------------------------------------------
// primitive controls
// ---------------------------------------------------------------------------

function textControl(field: FieldDescriptor, obj: any, ctx: ControlCtx): HTMLElement {
    const input = html`<input class="explore-input" type="text" value=${obj[field.name] ?? ''}
        oninput=${() => { obj[field.name] = input.value; }}>` as HTMLInputElement;
    return input;
}

function intControl(field: FieldDescriptor, obj: any, ctx: ControlCtx): HTMLElement {
    const v = obj[field.name];
    const input = html`<input class="explore-input" type="number" value=${v == null ? '' : String(v)}
        oninput=${() => { obj[field.name] = input.value === '' ? null : Number(input.value); }}>` as HTMLInputElement;
    return input;
}

function boolControl(field: FieldDescriptor, obj: any, ctx: ControlCtx): HTMLElement {
    const input = html`<input type="checkbox" onchange=${() => { obj[field.name] = input.checked; }}>` as HTMLInputElement;
    input.checked = !!obj[field.name];
    return html`<div class="explore-inline">${input}</div>` as HTMLElement;
}

function selectControl(field: FieldDescriptor, obj: any, ctx: ControlCtx): HTMLElement {
    // Enum zero value is the empty string (Plot default) — offer it explicitly.
    const opts = ['', ...(field.options ?? [])].map((o) =>
        html`<option value=${o}>${o === '' ? '(default)' : o}</option>`);
    const sel = html`<select class="explore-input" onchange=${() => { obj[field.name] = sel.value; }}>${opts}</select>` as HTMLSelectElement;
    sel.value = obj[field.name] ?? '';
    return sel;
}

function stringListControl(field: FieldDescriptor, obj: any, ctx: ControlCtx): HTMLElement {
    if (!Array.isArray(obj[field.name])) obj[field.name] = obj[field.name] ?? [];
    const list: string[] = obj[field.name];
    const container = html`<div class="explore-rowlist"></div>` as HTMLElement;

    function redraw() {
        const rows = list.map((val, i) => {
            const input = html`<input class="explore-input" value=${val} oninput=${() => { list[i] = input.value; }}>` as HTMLInputElement;
            return html`<div class="explore-row">${input}${iconButton('×', () => { list.splice(i, 1); redraw(); })}</div>`;
        });
        container.replaceChildren(...rows, addButton('+ add', () => { list.push(''); redraw(); }));
    }
    redraw();
    return container;
}

function keyValueControl(field: FieldDescriptor, obj: any, ctx: ControlCtx): HTMLElement {
    if (obj[field.name] == null || typeof obj[field.name] !== 'object') obj[field.name] = obj[field.name] ?? {};
    const map: Record<string, string> = obj[field.name];
    const container = html`<div class="explore-rowlist"></div>` as HTMLElement;

    function redraw() {
        const rows = Object.entries(map).map(([k, v]) => {
            const kIn = html`<input class="explore-input" placeholder="key" value=${k}>` as HTMLInputElement;
            const vIn = html`<input class="explore-input" placeholder="value" value=${v}>` as HTMLInputElement;
            kIn.onchange = () => { delete map[k]; map[kIn.value] = vIn.value; redraw(); };
            vIn.oninput = () => { map[kIn.value] = vIn.value; };
            return html`<div class="explore-row">${kIn}${vIn}${iconButton('×', () => { delete map[k]; redraw(); })}</div>`;
        });
        container.replaceChildren(...rows, addButton('+ add', () => { map[''] = ''; redraw(); }));
    }
    redraw();
    return container;
}

// ---------------------------------------------------------------------------
// field picker (composite) — SqlField / TimestampedField
// ---------------------------------------------------------------------------

// The preferred column class of a slot: a timestamped dimension buckets a
// temporal column (autoBucket), a plain dimension groups a categorical one
// (enum). Measures pick no column class.
function slotColumnClass(field: FieldDescriptor): ColumnClass {
    return field.timestamped ? 'temporal' : 'categorical';
}

// The wire "kinds" that apply to a slot, derived from its role (dimension |
// measure) and column class — not a single timestamped bit (B4). A kind is
// offered when it serves the slot's role AND (it is class-agnostic, e.g.
// count/expr, or its class matches the slot's). So a bar-chart X (dimension,
// categorical) offers enum + expr but never "Row count" (a measure); a time X
// (dimension, temporal) offers autoBucket; a Y (measure) offers count + expr.
// Order follows the served fieldKinds (golden-path first).
function kindsForSlot(field: FieldDescriptor, fieldKinds: FieldKind[]): string[] {
    const role = field.role;
    const slotClass = slotColumnClass(field);
    return fieldKinds
        .filter((k) => !role || (k.roles ?? []).includes(role))
        .filter((k) => !k.columnClass || k.columnClass === slotClass)
        .map((k) => k.kind);
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
    const container = html`<div class="explore-field-picker"></div>` as HTMLElement;

    const slotKinds = kindsForSlot(field, ctx.fieldKinds);
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
        const parts: (Node | string)[] = [];

        // kind dropdown — human labels, advanced kinds gated by the toggle.
        const shown = advanced ? slotKinds : slotKinds.filter((k) => !info(k).advanced);
        const opts = (field.required ? shown : ['', ...shown]).map((k) =>
            html`<option value=${k}>${k === '' ? '(none)' : info(k).label}</option>`);
        const kindSel = html`<select class="explore-input" onchange=${() => {
            obj[field.name] = seedKind(kindSel.value);
            redraw();
        }}>${opts}</select>` as HTMLSelectElement;
        kindSel.value = currentKind();
        parts.push(kindSel);

        const v = obj[field.name];
        if (v && typeof v === 'object') {
            const preferred = (info(v.kind).columnClass ?? '') as ColumnClass;

            if (v.kind === 'autoBucket') {
                const col = html`<input class="explore-input" placeholder="column" value=${v.column ?? ''}
                    oninput=${() => { v.column = col.value; }}>` as HTMLInputElement;
                parts.push(attachColumnCompletion(col, ctx, preferred || 'temporal'), col);
            } else if (v.kind === 'enum') {
                // Present the underlying column; store the ::String cast expression.
                const col = html`<input class="explore-input" placeholder="column"
                    value=${(v.definition ?? '').replace(/::String$/, '')}
                    oninput=${() => {
                        v.definition = col.value ? `${col.value}::String` : '';
                        if (!v.alias) v.alias = col.value;
                    }}>` as HTMLInputElement;
                parts.push(attachColumnCompletion(col, ctx, preferred || 'categorical'), col);
            } else if (v.kind === 'expr') {
                const def = html`<input class="explore-input" placeholder="SQL expression" value=${v.definition ?? ''}
                    oninput=${() => { v.definition = def.value; }}>` as HTMLInputElement;
                parts.push(attachColumnCompletion(def, ctx, null), def);
            }
            // count: no extra input besides the (advanced) alias.

            if (advanced) {
                const alias = html`<input class="explore-input" placeholder="alias (column name in result)"
                    value=${v.alias ?? ''} oninput=${() => { v.alias = alias.value; }}>` as HTMLInputElement;
                parts.push(alias);
            }
        }

        // advanced toggle — only shown when there is anything advanced to reveal
        // (a custom-expression kind, or the alias input on a chosen kind).
        const hasAdvancedKind = slotKinds.some((k) => info(k).advanced);
        if (hasAdvancedKind || (v && typeof v === 'object')) {
            const cb = html`<input type="checkbox" onchange=${() => { advanced = cb.checked; redraw(); }}>` as HTMLInputElement;
            cb.checked = advanced;
            parts.push(html`<label class="explore-advanced-toggle">${cb}<span>Advanced (custom expression, alias)</span></label>`);
        }

        container.replaceChildren(...parts);
    }
    redraw();
    return container;
}

// ---------------------------------------------------------------------------
// colorScale — legend + unknown + scheme + domain/range rows
// ---------------------------------------------------------------------------

function colorScaleControl(field: FieldDescriptor, obj: any, ctx: ControlCtx): HTMLElement {
    const container = html`<div class="explore-colorscale"></div>` as HTMLElement;

    function redraw() {
        const enabled = obj[field.name] != null && typeof obj[field.name] === 'object';

        const toggle = html`<input type="checkbox" onchange=${() => {
            obj[field.name] = toggle.checked ? {legend: false, domain: [], range: [], unknown: '#8E44AD'} : null;
            redraw();
        }}>` as HTMLInputElement;
        toggle.checked = enabled;
        const parts: (Node | string)[] = [html`<div class="explore-inline">${toggle}<span>custom color scale</span></div>`];

        if (enabled) {
            const cs = obj[field.name];

            const legend = html`<input type="checkbox" onchange=${() => { cs.legend = legend.checked; }}>` as HTMLInputElement;
            legend.checked = !!cs.legend;
            parts.push(html`<div class="explore-inline">${legend}<span>show legend</span></div>`);

            // value -> color mappings (domain[i] -> range[i])
            cs.domain = cs.domain ?? [];
            cs.range = cs.range ?? [];
            cs.domain.forEach((dv: string, i: number) => {
                const valIn = html`<input class="explore-input" placeholder="value" value=${dv}
                    oninput=${() => { cs.domain[i] = valIn.value; }}>` as HTMLInputElement;
                const colIn = html`<input type="color" value=${cs.range[i] || '#888888'}
                    oninput=${() => { cs.range[i] = colIn.value; }}>` as HTMLInputElement;
                parts.push(html`<div class="explore-row">${valIn}${colIn}${
                    iconButton('×', () => { cs.domain.splice(i, 1); cs.range.splice(i, 1); redraw(); })}</div>`);
            });
            parts.push(addButton('+ mapping', () => { cs.domain.push(''); cs.range.push('#888888'); redraw(); }));
        }

        container.replaceChildren(...parts);
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
    return html`<div class="explore-group">${(field.fields ?? []).map((sub) => makeControl(sub, inner, ctx))}</div>` as HTMLElement;
}

// ---------------------------------------------------------------------------
// query section — SqlQueryable envelope (table | file | raw)
// ---------------------------------------------------------------------------

export function makeQuerySection(props: any, queryKey: string, ctx: ControlCtx): HTMLElement {
    if (props[queryKey] == null || typeof props[queryKey] !== 'object') {
        props[queryKey] = {kind: 'table', table: '', where: []};
    }
    const body = html`<div></div>` as HTMLElement;
    const container = html`<div class="explore-query">
        <div class="explore-section-title">Query</div>
        ${body}
    </div>` as HTMLElement;

    // Only the source *kind* switch rebuilds the body (it swaps which inputs
    // exist). Individual inputs mutate in place and never re-render, so typing
    // in the table / where fields never loses focus.
    function rebuild() {
        const q = props[queryKey];

        const kindSel = html`<select class="explore-input" onchange=${() => {
            props[queryKey] = kindSel.value === 'raw'
                ? {kind: 'raw', sql: 'SELECT * FROM ... WHERE {{DASHICA_FILTERS}}'}
                : {kind: 'table', table: '', where: []};
            rebuild();
        }}>
            <option value="table">Table</option>
            <option value="raw">Raw SQL</option>
        </select>` as HTMLSelectElement;
        kindSel.value = q.kind === 'raw' ? 'raw' : 'table';
        const parts: (Node | string)[] = [labelled({name: 'source', editor: 'select'}, kindSel)];

        if (q.kind === 'raw') {
            const ta = html`<textarea class="explore-input explore-textarea" rows="6"
                oninput=${() => { q.sql = ta.value; }}></textarea>` as HTMLTextAreaElement;
            ta.value = q.sql ?? '';
            trackSqlFocus(ta);
            parts.push(labelled({name: 'sql', editor: 'rawSql', help: 'Must contain {{DASHICA_FILTERS}}.'}, ta));
        } else {
            const id = `explore-tables-${datalistSeq++}`;
            const dl = html`<datalist id=${id}>${
                (ctx.schema?.tables ?? []).map((t) => html`<option value=${t}></option>`)}</datalist>`;
            // No re-render on input — just mutate, so focus is kept while typing.
            // Chosen a table? let the form seed required-but-empty pickers so
            // "pick a table = a rendering chart" (docs UX plan (3)). The seeder
            // rebuilds only the options section, never this focused input.
            const tbl = html`<input class="explore-input" list=${id} value=${q.table ?? ''}
                oninput=${() => {
                    q.table = tbl.value;
                    if (tbl.value && ctx.onTableChosen) ctx.onTableChosen(tbl.value);
                }}>` as HTMLInputElement;
            parts.push(dl, labelled({name: 'table', editor: 'text'}, tbl));

            // collapsible column reference for the chosen table — badge + name +
            // type; clicking a column inserts its name into the last-focused
            // WHERE / expression input (docs UX plan (2)).
            parts.push(columnReference(ctx));

            // where clause list
            q.where = q.where ?? [];
            const whereWrap = html`<div class="explore-rowlist"></div>` as HTMLElement;
            const drawWhere = () => {
                const rows = (q.where as string[]).map((w, i) => {
                    const input = html`<input class="explore-input" placeholder="e.g. level = 'error'" value=${w}
                        oninput=${() => { q.where[i] = input.value; }}>` as HTMLInputElement;
                    const cdl = attachColumnCompletion(input, ctx, null);
                    return html`<div class="explore-row">${cdl}${input}${
                        iconButton('×', () => { q.where.splice(i, 1); drawWhere(); })}</div>`;
                });
                whereWrap.replaceChildren(...rows, addButton('+ WHERE', () => { q.where.push(''); drawWhere(); }));
            };
            drawWhere();
            parts.push(labelled({name: 'where', editor: 'whereClause'}, whereWrap));
        }
        body.replaceChildren(...parts);
    }
    rebuild();
    return container;
}

// columnReference is the collapsible list of the current table's columns, shown
// under the table input. Repopulates each time it is opened, so it always
// reflects the current table. Clicking a column inserts its name at the cursor
// in the last-focused WHERE / expression input.
function columnReference(ctx: ControlCtx): HTMLElement {
    const list = html`<div class="explore-colref__list"></div>` as HTMLElement;
    const details = html`<details class="explore-colref">
        <summary>Columns</summary>
        ${list}
    </details>` as HTMLElement;

    const populate = () => {
        const table = ctx.getTable();
        const cols = (table && ctx.schema?.columns[table]) || [];
        if (cols.length === 0) {
            list.replaceChildren(html`<div class="explore-field__help">${table ? 'No columns.' : 'Pick a table first.'}</div>`);
            return;
        }
        list.replaceChildren(...cols.map((c) => {
            const badge = classBadge(c.class);
            return html`<button type="button" class="explore-colref__col"
                title=${`${c.type}${c.comment ? ` — ${c.comment}` : ''} (click to insert)`}
                onclick=${() => insertIntoLastSqlInput(c.name)}>
                ${badge ? html`<span class="explore-badge">${badge}</span>` : ''}
                <span class="explore-colref__name">${c.name}</span>
                <span class="explore-colref__type">${c.type}</span>
            </button>`;
        }));
    };
    details.addEventListener('toggle', () => { if ((details as HTMLDetailsElement).open) populate(); });
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
            // Temporal dimension: auto-bucket the first temporal column.
            const col = firstOfClass('temporal');
            if (!v || typeof v !== 'object' || v.kind !== 'autoBucket') {
                props[f.name] = {kind: 'autoBucket', column: col ?? '', alias: 'time'};
                changed = true;
            } else if (!v.column && col) {
                v.column = col;
                changed = true;
            }
        } else if (f.role === 'dimension') {
            // Categorical dimension: group by the first categorical column.
            const col = firstOfClass('categorical');
            if (!v || typeof v !== 'object' || v.kind !== 'enum') {
                props[f.name] = col
                    ? {kind: 'enum', definition: `${col}::String`, alias: col}
                    : seedKind('enum');
                changed = true;
            } else if (!v.definition && col) {
                v.definition = `${col}::String`;
                if (!v.alias) v.alias = col;
                changed = true;
            }
        } else if (!v || typeof v !== 'object' || !v.kind) {
            // A measure with nothing chosen defaults to row count (renders
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
        case 'children':
            return labelled(field, html`<div class="explore-field__help">Nested widgets (grid/group) are edited in a later phase.</div>` as HTMLElement);
        default:
            return labelled(field, html`<div class="explore-field__help">Unsupported editor: ${field.editor}</div>` as HTMLElement);
    }
}
