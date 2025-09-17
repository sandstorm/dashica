import * as Inputs from "@observablehq/inputs";
import {html} from "htl";
import {DataType, Field} from "apache-arrow";
import {withRuntime} from '../util/runtime.js';
import type {QueryResult} from "../types";
import {recordDetails} from "./recordDetails.js";

export function autoTableCombined(queryResult: QueryResult, tableOpts, invalidation: any) {
    return withRuntime(async(o) => {
        const $data = o.$cell([], () => queryResult);
        const searchC = o.$cell([$data], (data) => Inputs.search(data, {placeholder: "Search records"}));

        const tableC = o.$cell([$data, o.$widgetValues(searchC)], (data, searchResults) => autoTable(data, searchResults, tableOpts));
        const recordDetailsC = o.$cell([o.$widgetValues(tableC)], (tableResultsSelected) => recordDetails(tableResultsSelected));

        // TODO: support invalidation

        return o.render`<div>
            ${searchC}
            ${tableC}
            ${recordDetailsC}
            </div>`;
    });
}

export function autoTable(origDataForSchema: any, data: any, extProps: any): HTMLElement {
    const props = Object.assign({}, extProps);
    // Reference: https://github.com/observablehq/inputs?tab=readme-ov-file#table
    props.format = props.format || {};
    props.width = props.width || {};

    origDataForSchema?.schema?.fields?.forEach((field: Field) => {
        if (DataType.isTimestamp(field)) {
            props.width[field.name] = '110px';
            props.format[field.name] = (value: any, idx: number, all: any[]) => {
                const dt = new Date(value);
                const time = dt.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false // Use 24-hour format
                });
                const date = dt.toLocaleDateString([], {
                    day: '2-digit',
                    month: '2-digit',
                    year: '2-digit',
                })
                const el = html`${time} &nbsp; <span class="autoTable__timestampDate">${date}</span>`;
                el.addEventListener('dblclick', (...args) => {
                    window.dispatchEvent(new CustomEvent('dashica-add-filter', {detail: `${field.name} = '${value}'`}));
                });
                return el;
            };
        } else {
            const originalFormatter = props.format[field.name] || ((d: any) => d);
            props.format[field.name] = (value: any, idx: number, all: any[]) => {
                const el = html`<span>${originalFormatter(value)}</span>`;
                el.addEventListener('dblclick', (...args) => {
                    window.dispatchEvent(new CustomEvent('dashica-add-filter', {detail: `${field.name} = '${value}'`}));
                });

                return el;
            };
        }
    });
    const tbl = Inputs.table(data, props);

    const root = html`
        <div class="autoTable">${tbl}</div>`;
    // Expose selected elements to outer world
    // https://observablehq.com/@john-guerra/reactive-widgets
    return Object.defineProperty(root, "value", {
        get() {
            // @ts-ignore
            return tbl.value;
        },
    });
}

function renderRecord(record: Record<string, any>): HTMLElement {
    return html`
        <div class="recordDetails__record">
            ${Object.entries(record).map(renderRecordRow)}
        </div>`;
}

function renderRecordRow(recordRow: [string, any]): HTMLElement {
    let [key, value] = recordRow;
    if (String(value).startsWith('{')) {
        // try to parse as JSON and format it.
        value = JSON.stringify(JSON.parse(value), null, "  ");
        return html`
            <p class="font-mono">
                <span class="font-bold">${key}</span>:
                <span class="break-all"><pre>${value}</pre></span>
            </p>`;
    } else {
        return html`<p class="font-mono">
            <span class="font-bold">${key}</span>:
            <span class="break-all">${value}</span>
        </p>`;
    }
}
