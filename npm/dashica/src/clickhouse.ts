import type {QueryResult} from "./types.js";
import * as Arrow from 'apache-arrow';

export interface QueryOptions {
    filters?: Record<string, string>,
    params?: Record<string, string>,
}

export async function getSpeedscopeUrl(fileName: string, options: QueryOptions = {}) {
    const params = new URLSearchParams();
    params.append("fileName", fileName);
    if (options.filters) {
        params.append("filters", JSON.stringify(options.filters));
    }

    if (options.params) {
        params.append("params", JSON.stringify(options.params));
    }

    return "/api/speedscopeQuery?" + params.toString();
}

export async function query(fileName: string, options: QueryOptions = {}): Promise<QueryResult> {
    const params = new URLSearchParams();
    params.append("fileName", fileName);
    if (options.filters) {
        params.append("filters", JSON.stringify(options.filters));
    }

    if (options.params) {
        params.append("params", JSON.stringify(options.params));
    }

    let abortController = new AbortController();
    if (options.filters) {
        window.addEventListener('dashica-stop-all-running-filter-requests', () => abortController.abort());
    }
    const response = await fetch("/api/query?" + params.toString(), {
        signal: abortController.signal,
    });

    if (response.status !== 200) {
        const errorContents = await response.text();
        throw new Error(errorContents);
    }
    const result: QueryResult = await Arrow.tableFromIPC(response);
    result.dashicaResolvedTimeRange = JSON.parse(response.headers.get("X-Dashica-Resolved-Time-Range") || "null");
    const xBucketSize = response.headers.get("X-Dashica-Bucket-Size")
    if (xBucketSize != null) {
        result.dashicaBucketSize = parseInt(xBucketSize);
    }
    result.clickhouseSummary = JSON.parse(response.headers.get("X-Clickhouse-Summary") || "null");
    return result;

    // Add metadata
    // TODO: data.query = query;
}

export async function showTableStructure(table: string): Promise<string> {
    const params = new URLSearchParams();
    params.append("table", table);

    const response = await fetch("/api/showTableStructure?" + params.toString());
    if (response.status !== 200) {
        const errorContents = await response.text();
        throw new Error(errorContents);
    }
    return response.text();
}


export async function queryAlertChartDetails(alertId: string, options: QueryOptions = {}): Promise<QueryResult> {
    const params = new URLSearchParams();
    params.append("alertId", alertId);
    if (options.filters) {
        params.append("filters", JSON.stringify(options.filters));
    }

    const response = await fetch("/api/query-alert-chart?" + params.toString());
    if (response.status !== 200) {
        throw new Error("Response status: " + response.statusText)
    }
    const result: QueryResult = await Arrow.tableFromIPC(response);
    result.dashicaResolvedTimeRange = JSON.parse(response.headers.get("X-Dashica-Resolved-Time-Range") || "null");
    result.dashicaAlertIf = JSON.parse(response.headers.get("X-Dashica-Alert-If") || "null");
    result.clickhouseSummary = JSON.parse(response.headers.get("X-Clickhouse-Summary") || "null");
    return result;

    // Add metadata
    // TODO: data.query = query;
}



// TODO: queryAlertStatus?
export async function queryAlerts(options: QueryOptions = {}): Promise<QueryResult> {
    const params = new URLSearchParams();
    if (options.filters) {
        params.append("filters", JSON.stringify(options.filters));
    }

    const response = await fetch("/api/query-alerts?" + params.toString());
    if (response.status !== 200) {
        throw new Error("Response status: " + response.statusText);
    }
    const result: QueryResult = await Arrow.tableFromIPC(response);
    result.dashicaResolvedTimeRange = JSON.parse(response.headers.get("X-Dashica-Resolved-Time-Range") || "null");
    result.clickhouseSummary = JSON.parse(response.headers.get("X-Clickhouse-Summary") || "null");
    result.dashicaDevmode = Boolean(response.headers.get("X-Dashica-Devmode"));
    return result;

    // Add metadata
    // TODO: data.query = query;
}


export type ClickhouseSchema = {
    tables: string[],
    commonColumns: string[]
}

export async function schema(): Promise<ClickhouseSchema> {
    const response = await fetch('/api/schema');
    return await response.json() as unknown as ClickhouseSchema;
}
