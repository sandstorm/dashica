import {html} from "htl";

export function sqlFilterButton(label: string, sqlFilter: string) {
    const linkEl = html`<button>${label}</button>`;
    linkEl.addEventListener('click', () => {
        if (sqlFilter.includes('...')) {
            const parameter = prompt("Parameter value");
            if (parameter) {
                sqlFilter = sqlFilter.replaceAll('...', parameter);
            }
        }
        window.dispatchEvent(new CustomEvent('dashica-add-filter', {detail: sqlFilter}));
    })
    return linkEl;
}
