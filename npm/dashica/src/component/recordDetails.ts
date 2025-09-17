import {html} from "htl";


export function recordDetails(records: Record<string, any>[]): HTMLElement {
    // TODO: if async generator -> DO STUFF
    return html`<div class="recordDetails">
            ${records.map(renderRecord)}
        </div>`;
}

function renderRecord(record: Record<string, any>): HTMLElement {
    return html`<div class="recordDetails__record">
                ${Object.entries(record).map(renderRecordRow)}
            </div>`;
}

function renderRecordRow(recordRow: [string, any]): HTMLElement {
    let [key, value] = recordRow;

    const valueStr = String(value);

    if (valueStr.trim().startsWith('{')) {
        try {
            value = JSON.stringify(JSON.parse(valueStr), null, "  ");
            return html`<p class="font-mono">
                <span class="font-bold">${key}</span>:
                <span class="break-all"><pre>${value}</pre></span>
            </p>`;
        } catch (e) {
            // If parsing fails, handle as regular value
        }
    }

    // Check if the value (after trimming) contains newlines
    if (valueStr.trim().includes('\n')) {
        return html`<p class="font-mono">
            <span class="font-bold">${key}</span>:
            <span class="break-all"><pre>${valueStr}</pre></span>
        </p>`;
    } else {
        return html`<p class="font-mono">
            <span class="font-bold">${key}</span>:
            <span class="break-all">${valueStr}</span>
        </p>`;
    }
}