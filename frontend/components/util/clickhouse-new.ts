import type {QueryResult} from "../../types";
import * as Arrow from 'apache-arrow';

export interface QueryOptions {
    filters?: Record<string, string>,
    params?: Record<string, string>,
}


export type ClickhouseSchema = {
    tables: string[],
    commonColumns: string[]
}


function filterParams(filters: any, widgetParams?: Record<string, string>): string {
    const params = new URLSearchParams();
    if (filters) {
        params.append("filters", JSON.stringify(filters));
    }
    if (widgetParams && Object.keys(widgetParams).length > 0) {
        params.append("params", JSON.stringify(widgetParams));
    }
    return params.toString();
}

async function parseQueryResponse(response: Response): Promise<QueryResult> {
    if (response.status !== 200) {
        throw new Error(await response.text());
    }
    const result: QueryResult = await Arrow.tableFromIPC(response);
    result.dashicaResolvedTimeRange = JSON.parse(response.headers.get("X-Dashica-Resolved-Time-Range") || "null");
    const xBucketSize = response.headers.get("X-Dashica-Bucket-Size")
    if (xBucketSize != null) {
        result.dashicaBucketSize = parseInt(xBucketSize);
    }
    result.clickhouseSummary = JSON.parse(response.headers.get("X-Clickhouse-Summary") || "null");
    result.dashicaAlertIf = JSON.parse(response.headers.get("X-Dashica-Alert-If") || "null");
    return result;
}

export async function query(baseUrl: string, filters: any, widgetParams?: Record<string, string>): Promise<QueryResult> {
    const response = await fetch(baseUrl + "?" + filterParams(filters, widgetParams));
    return parseQueryResponse(response);
}

// queryPost is query() for the Explore preview: the widget is described in the
// POST body (a widget envelope) instead of being baked into a compiled /query
// endpoint. Response format is identical, so the same chart renderer consumes it.
export async function queryPost(baseUrl: string, body: string, filters: any, widgetParams?: Record<string, string>): Promise<QueryResult> {
    const response = await fetch(baseUrl + "?" + filterParams(filters, widgetParams), {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body,
    });
    return parseQueryResponse(response);
}



