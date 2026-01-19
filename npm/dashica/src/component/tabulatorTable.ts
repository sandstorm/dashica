import * as Inputs from "@observablehq/inputs";
import {html} from "htl";
import {DataType, Field} from "apache-arrow";
import {TabulatorFull as Tabulator} from 'tabulator-tables';
import type {ColumnDefinition, RowComponent} from 'tabulator-tables';

const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d');

function calculateSizeOfColumn(rows: RowComponent[], fieldName: string) {

    if (!ctx) {
        return true;
    }

    if (rows.length > 0) {
        const cell = rows[0].getCell(fieldName)
        if (!cell) {
            return true;
        }

        const computedStyle = window.getComputedStyle(cell.getElement());
        const fontSize = computedStyle.getPropertyValue('font-size');
        const fontFamily = computedStyle.getPropertyValue('font-family');

        ctx.font = fontSize + " " + fontFamily;
    } else {
        return true;
    }

    let maxWidth = 0;
    rows.forEach(row => {
        let text = ctx.measureText(row.getData()[fieldName]);
        if (maxWidth < text.width) {
            maxWidth = text.width;
        }
    });

    return Math.ceil(maxWidth) + 10;
}

export function tabulatorTable(origDataForSchema: any, data: any, extProps: any) {
    console.log("AUTOTABLE2");
    const props = Object.assign({}, extProps);
    // Reference: https://github.com/observablehq/inputs?tab=readme-ov-file#table
    props.format = props.format || {};
    props.width = props.width || {};

    const exampleDataPerField: {[key: string]: any[]} = {};
    for (let i = 0; i < 10; i++) {
        if (!data[i]) {
            break;
        }
        origDataForSchema?.schema?.fields?.forEach((field) => {
            if (!exampleDataPerField[field.name]) {
                exampleDataPerField[field.name] = [];
            }
            exampleDataPerField[field.name].push(data[i][field.name]);
        });
    }



    console.log("exampleDataPerField", exampleDataPerField);



    const columns: ColumnDefinition[] = [];
    origDataForSchema?.schema?.fields?.forEach((field: any) => {
        if (DataType.isTimestamp(field)) {
            /*props.width[field.name] = '110px';
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
            };*/
        } else {
            columns.push({
                title: field.name,
                field: field.name,
                //width: 200,
            });
        }
    });
    const root = html`<div class="tabulatorTable"></div>`;

    var table = new Tabulator(root, {
        height:props.height, // set height of table (in CSS or here), this enables the Virtual DOM and improves render speed dramatically (can be any valid css height value)
        maxHeight: "100vh",
        data:data, //assign data to table
        layout:"fitData", //fit columns to width of table (optional)
        columns: columns,
        movableColumns: true, //enable user movable columns
        //persistence:true,
        //selectableRows:true,
        rowHeader:{formatter:"rowSelection", titleFormatter:"rowSelection", headerSort:false, resizable: false, frozen:true, headerHozAlign:"center", hozAlign:"center"},
        columnDefaults:{
            tooltip:function(e, cell, onRendered){
                if (!cell.getValue()) {
                    return "";
                }
                return html`<div class="tabulatorTable__tooltip"><code>${cell.getValue()}</code></div>`;
            },
            headerMenu: [
                {
                    label:"Auto-size column (based on visible data)",
                    action:function(e, column){
                        const visibleRows = column.getTable().getRows("visible");
                        column.setWidth(calculateSizeOfColumn(visibleRows, column.getField()));
                    }
                },
                {
                    label:"Auto-size all columns (based on visible data)",
                    action:function(e, column){
                        const visibleRows = column.getTable().getRows("visible");
                        column.getTable().getColumns().forEach(c => {
                            c.setWidth(calculateSizeOfColumn(visibleRows, c.getField()));
                        })
                    }
                }
            ]
        }
    });


    // Expose selected elements to outer world
    // https://observablehq.com/@john-guerra/reactive-widgets
    return Object.defineProperty(root, "value", {
        get() {
            return [];
            // @ts-ignore
            //return tbl.value;
        },
    });
}