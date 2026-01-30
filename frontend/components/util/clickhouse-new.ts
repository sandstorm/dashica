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


export async function query(baseUrl: string, filters: any): Promise<QueryResult> {
    const params = new URLSearchParams();
    if (filters) {
        params.append("filters", JSON.stringify(filters));
    }

    let abortController = new AbortController();
    const response = await fetch(baseUrl + "?" + params.toString(), {
        signal: abortController.signal,
    });

    if (response.status !== 200) {
        const errorContents = await response.text();
        throw new Error(errorContents);
    }
    const result: QueryResult = await Arrow.tableFromIPC(response);
    console.log("RESULT", result);
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



