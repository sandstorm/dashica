import {Runtime} from '@observablehq/runtime'
import {Inspector} from '@observablehq/inspector'
import {html} from "htl";
import {Generators} from "observablehq:stdlib";


// Symbol used to mark a variable as a Cell
const CellMarker: unique symbol = Symbol.for("CellMarker");

/**
 * Represents a variable in the Observable runtime
 */
interface Cell<T = any> {
    // Cell identification
    readonly [CellMarker]: true;

    // Value access (implementation specific)
    value: T;

    // Name of cell
    _vName: string;
}

type CellFn = <InputCells extends readonly Cell<any>[], T>(inputs: InputCells, fn: (...inputValues: ExtractCellValues<InputCells>) => T) => Cell<UnwrapValue<T>>;

// Type guard function
function isCell<T>(obj: any): obj is Cell<T> {
    return obj !== null &&
        typeof obj === 'object' &&
        Object.getOwnPropertySymbols(obj).includes(CellMarker);
}

type UnwrapGenerator<T> =
    T extends Generator<infer R, any, any> ? R :
        T;

type UnwrapPromise<T> =
    T extends Promise<infer R> ? R :
        T;

type UnwrapValue<T> = UnwrapPromise<UnwrapGenerator<T>>;

interface WithRuntime {
    $name: (cell: Cell | string) => string;
    $cell: CellFn;
    $value: (cell: Cell | string) => Promise<any>;
    $widgetValues: (cell: Cell | string) => Cell<any>;
    $raw: (cell: Cell | string) => HTMLElement;
    render: (strings: TemplateStringsArray, ...values: any[]) => HTMLElement;
    renderWithWidgetValues($valuesCell: Cell): (strings: TemplateStringsArray, ...values: any[]) => HTMLElement;
    $inspect: (cell: Cell) => HTMLElement;
}

/**
 * Helper type to extract cell values from an array of cell variables
 */
type ExtractCellValues<T extends readonly Cell<any>[]> = {
    [K in keyof T]: T[K] extends Cell<infer U> ? U : never;
};

/**
 * TAKEN FROM https://observablehq.com/d/aebbadaa71a6c0ae
 *
 * @param callback
 * @param invalidation
 * @param Cell
 * @returns {*}
 */
export function withRuntime(callback: (o: WithRuntime) => any, {
    invalidation,
} = {}) {
    const runtime = new Runtime();
    invalidation?.then(() => runtime.dispose());
    const module = runtime.module();
    const names = new WeakMap();
    return callback({$name, $cell, $value, $widgetValues, $inspect, $raw, render, renderWithWidgetValues});

    /**
     * Returns a placeholder Node and replaces it with the resolved Node.
     *
     * @param {Promise<Node> | Node} d
     * @returns {Node}
     */
    function placeholder(d) {
        if (!(d instanceof Promise)) return d;
        const node = document.createComment("");
        d.then(d => {
            if (!node.parentElement) return;
            if (!(d instanceof Node)) d = document.createTextNode(String(d));
            node.parentElement.replaceChild(d, node);
        });
        return node;
    }

    /**
     * Returns a cell's name.
     *
     * @param {Cell | string} d
     * @returns {string}
     */
    function $name(d: Cell) {
        // TODO if (!isCell(d)) {
        //    throw new Error("o.$name() requires a Cell");
        //}

        if (!names.has(d)) names.set(d, identifier());
        return names.get(d);
    }

    /**
     * Returns a cell's last value.
     *
     * @param {Cell} d
     * @returns {Promise}
     */
    function $value(d: Cell) {
        return module.value(d._vName);
    }

    /**
     * Subscribes to a widget's values.
     *
     * @param {Cell | string} cell
     * @returns
     */
    function $widgetValues(cell: Cell): Cell<any> {
        return $cell([cell], function (view) {
            if (!view.addEventListener) {
                throw new Error(`o.$widgetValues() requires a widget, ${typeof view} given.`);
            }
            return Generators.input(view);
        });
    }

    /**
     * Defines a new cell.
     *
     */
    function $cell<InputCells extends readonly Cell<any>[], T>(inputs: InputCells, fn: (...inputValues: ExtractCellValues<InputCells>) => T): Cell<UnwrapValue<T>> {
        // Input validation
        if (arguments.length !== 2) {
            throw new Error("o.$cell() requires two arguments: an array of input cells and a calculation function.");
        }
        inputs.forEach((input, i) => {
            if (typeof input !== 'object') {
                throw new Error(`o.$cell() input list requires a list of Cells; error at ${i + 1}: ${typeof input}`);
            }
            if (!isCell(input)) {
                throw new Error(`o.$cell() input list requires a list of Cells; error at ${i + 1}: (arbitrary object, but no Cell)`);
            }
        });


        // Create a new cell
        const v = module.variable();
        const name = $name(v);
        v.define($name(v), inputs.map($name), fn);
        return Object.defineProperties(v, {
            [CellMarker]: {value: true},
            _vName: {value: name}
        });
    }

    /**
     * Returns Inspector output for a cell.
     *
     * @param {Cell | string} cell
     * @returns {HTMLSpanElement}
     */
    function $inspect(cell: Cell) {
        const wrap = html`<span>`;
        if (!isCell(cell)) {
            throw new Error("o.$inspect() requires a Cell; passed in: " + typeof cell);
        }
        module.variable(new Inspector(wrap)).define(null, [cell._vName], d => {
            return d;
        });
        return wrap;
    }

    /**
     *
     *
     * @param {Cell | string} cell
     * @returns {HTMLSpanElement}
     */
    function $raw(cell: Cell) {
        if (!isCell(cell)) {
            throw new Error("o.$raw() requires a Cell; passed in: " + typeof cell);
        }
        const wrap = html`<span>`;
        const update = d => {
            wrap.replaceChildren(d);
        }

        const updateErr = (d: Error) => {
            wrap.replaceChildren(d + String(d.stack));
        }
        module.variable({fulfilled: update, rejected: updateErr}).define([cell._vName], d => d);
        return wrap;
    }

    function $onChange(cell: Cell, callback: (value: any) => void) {
        if (!isCell(cell)) {
            throw new Error("o.$onChange() requires a Cell; passed in: " + typeof cell);
        }
        module.variable({fulfilled: callback}).define([cell._vName], (v: any) => v);
    }

    /**
     * Return a Widget according to https://observablehq.com/@john-guerra/reactive-widgets
     *
     * @param $valuesCell
     */
    function renderWithWidgetValues($valuesCell: Cell): (strings: TemplateStringsArray, ...values: any[]) => HTMLElement {
        return function (strings: TemplateStringsArray, ...values: any[]) {
            const renderedWidget = render(strings, ...values);

            Object.defineProperty(renderedWidget, "value", {
                get() {
                    return $value($valuesCell);
                },
                set(value) {
                    throw new Error("Cannot set value of widget right now - TODO IMPLEMENT.");
                }
            });

            $onChange($valuesCell, () => {
                renderedWidget.dispatchEvent(new CustomEvent("input", { bubbles: true }))
            });

            return renderedWidget;
        };
    }

    /**
     * USE AS TAGGED TEMPLATE LITERAL
     * @param strings
     * @param values
     * @returns {HTMLElement}
     */
    function render(strings: TemplateStringsArray, ...values: any[]) {
        if (!Array.isArray(strings)) {
            throw new Error("o.render requires a tagged template literal - i.e. o.render`...`");
        }
        strings.forEach((s: any, i) => {
            if (typeof s !== 'string') {
                throw new Error(`o.render requires a tagged template literal - i.e. o.render\`...\` - param ${i + 1} is not a string, but ${typeof s}`);
            }
        })
        const resolve = (d: any) => {
            if (d[CellMarker]) {
                return $inspect(d);
            } else {
                return d;
            }
        };
        const map = (d: any) => d instanceof Promise
            ? placeholder(d.then(resolve))
            : resolve(d);
        return html(strings, ...values.map(map));
    }

}

var count = 0;

function identifier(name: string): string {
    return ("O_cell_" + ++count);
}
