// formRenderer.ts — the generic inspector form for one selected widget. It
// walks the widget's form-model descriptor (served by /explore/api/formmodel,
// derived by dashica-gen from the Go struct) and instantiates one control per
// field. No per-widget code: a new widget option appears here automatically.

import {html} from "htl";
import {ControlCtx, FieldDescriptor, makeControl, makeQuerySection, seedRequiredFields} from "./controls";

export interface WidgetDescriptor {
    title: string;
    // Editor category: "chart" widgets appear in the add-widget list; "parameter"
    // and "container" widgets stay serializable (compiled dashboards + "Open in
    // Explore" round-trip them) but are kept out of that flat list.
    category: 'chart' | 'parameter' | 'container';
    hasQuery: boolean;
    // JSON wire key of the query field (e.g. "sql"); provided when hasQuery.
    queryKey?: string;
    fields: FieldDescriptor[];
}

// renderForm fills `container` with the query section (if any) followed by one
// control per field, all bound to `props` (the widget's live props object).
//
// The query section stays mounted across option rebuilds so that choosing a
// table (which seeds the required X/Y pickers for the golden path) never steals
// focus from the table input: only the options section below is rebuilt.
export function renderForm(
    container: HTMLElement,
    descriptor: WidgetDescriptor,
    props: any,
    ctx: ControlCtx,
): void {
    container.innerHTML = '';

    if (descriptor.hasQuery && descriptor.queryKey) {
        // Golden path: when a table is chosen, seed required-but-empty field
        // pickers and rebuild just the options section (docs UX plan (3)).
        ctx.onTableChosen = (table: string) => {
            if (seedRequiredFields(descriptor.fields, props, ctx, table)) buildOptions();
        };
        container.appendChild(makeQuerySection(props, descriptor.queryKey, ctx));
    }

    const optsWrap = document.createElement('div');
    container.appendChild(optsWrap);

    function buildOptions() {
        // Nested-widget fields (childrenList/childrenMap) are NOT shown here — the
        // tree pane is the single place to add / select / reorder / remove / drag
        // children. Listing them in the inspector too was redundant clutter.
        const optionFields = descriptor.fields.filter(
            (f) => f.editor !== 'childrenList' && f.editor !== 'childrenMap');
        optsWrap.replaceChildren(html`<div class="explore-options">
            <div class="explore-section-title">Options</div>
            ${optionFields.map((field) => makeControl(field, props, ctx))}
        </div>`);
    }

    buildOptions();
}
