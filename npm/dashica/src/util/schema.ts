import type {Data} from "@observablehq/plot";
import type {ChannelValueSpec, QueryResult} from "../types";

/**
 * Helper class to give good error messages if user references non-existing columns in chart definitions.
 */
export class SchemaAnalyzer {
    private readonly columnNames: string[];
    constructor(data: QueryResult) {
        this.columnNames = columns(data);
    }

    requiredColumn(property: ChannelValueSpec, pathForErrorMessage?: string): ChannelValueSpec {
        if (pathForErrorMessage === undefined) {
            pathForErrorMessage = String(property);
        }
        if (typeof property !== 'string') {
            return property;
        }
        if (!property) {
            throw new Error(`${pathForErrorMessage}: not configured. Detected columns in data: ${this.columnNames.join(', ')}`)
        }

        if (!this.columnNames.includes(property)) {
            throw new Error(`${pathForErrorMessage}: the configured column ${property} does not exist in the data. Detected columns in data: ${this.columnNames.join(', ')}`)
        }

        return property;
    }
}


/**
 * Extract the column names from given data
 * Taken from https://github.com/observablehq/inputs/blob/main/src/table.js#L61C1-L61C73
 * @param data
 */
function columns(data: Data) {
    const columns = maybeColumns(data);
    return columns === undefined ? columnsof(data) : arrayify(columns);
}
/**
 * Extract the columns of the data - assumes tidy data, i.e. only checks first 10 rows.
 *
 * Taken and adapted from https://github.com/observablehq/inputs/blob/main/src/table.js#L404C1-L412C2
 * @param data
 */
function columnsof(data: Iterable<any>|ArrayLike<any>): string[] {
    const columns = new Set<string>();
    let i = 0;
    for (const row of arrayify(data)) {
        if (i >= 10) {
            // Only look at first 10 columns for identifying columns.
            return Array.from(columns);
        }
        for (const name in row) {
            columns.add(name);
        }
        i++;
    }
    return Array.from(columns);
}

/**
 * Taken from https://github.com/observablehq/inputs/blob/main/src/array.js
 */
function arrayify(array: any) {
    return Array.isArray(array) ? array : Array.from(array);
}

/**
 * Taken from https://github.com/observablehq/inputs/blob/main/src/array.js
 */
function iterable(array: any) {
    return array ? typeof array[Symbol.iterator] === "function" : false;
}

/**
 * Taken from https://github.com/observablehq/inputs/blob/main/src/array.js
 */
function maybeColumns(data: any): string[] | undefined {
    // d3-dsv, FileAttachment
    if (iterable(data.columns)) return data.columns;

    // apache-arrow
    if (data.schema && iterable(data.schema.fields)) {
        // @ts-ignore
        return Array.from(data.schema.fields, f => f.name);
    }
    // arquero
    if (typeof data.columnNames === "function") return data.columnNames();
}