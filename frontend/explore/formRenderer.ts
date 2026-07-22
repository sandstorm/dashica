// formRenderer.ts — the generic inspector form for one selected widget. It
// walks the widget's form-model descriptor (served by /explore/api/formmodel,
// derived by dashica-gen from the Go struct) and instantiates one control per
// field. No per-widget code: a new widget option appears here automatically.

import {ControlCtx, FieldDescriptor, makeControl, makeQuerySection} from "./controls";

export interface WidgetDescriptor {
    title: string;
    hasQuery: boolean;
    // JSON wire key of the query field (e.g. "sql"); provided when hasQuery.
    queryKey?: string;
    fields: FieldDescriptor[];
}

// renderForm fills `container` with the query section (if any) followed by one
// control per field, all bound to `props` (the widget's live props object).
export function renderForm(
    container: HTMLElement,
    descriptor: WidgetDescriptor,
    props: any,
    ctx: ControlCtx,
): void {
    container.innerHTML = '';

    if (descriptor.hasQuery && descriptor.queryKey) {
        container.appendChild(makeQuerySection(props, descriptor.queryKey, ctx));
    }

    const opts = document.createElement('div');
    opts.className = 'explore-options';
    const title = document.createElement('div');
    title.className = 'explore-section-title';
    title.textContent = 'Options';
    opts.appendChild(title);

    for (const field of descriptor.fields) {
        opts.appendChild(makeControl(field, props, ctx));
    }
    container.appendChild(opts);
}
