/**
 * What a chart's server side tells about one answer (X-Dashica-Diagnostics): the pills it ignores, or that it did not
 * run. Read by the `filters` extension, which shows it, and the Explore view.
 */
export interface Diagnostics {
  /** The labels of the page's pills the chart ignores (`['customer = acme']`: on another table), in the order of the URL. */
  readonly ignored?: readonly string[];
  /** Why the chart did not run; then its answer is a 204 without rows. */
  readonly skipped?: string;
}

/**
 * The Diagnostics of an answer (a chart's `QueryResult`, a `Response`): the header's JSON, percent-encoded as it
 * carries any text (a label's "≠", umlauts); `{}` without the header.
 */
export function diagnosticsOf({ headers }: { readonly headers: Headers }): Diagnostics {
  return JSON.parse(decodeURIComponent(headers.get('X-Dashica-Diagnostics') || '{}'));
}
