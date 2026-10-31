import type { QueryApi, QueryState, QueryStateSpec } from '../../hosts/query/query';

/**
 * The id of the page params in a tab's query state (`ctx.state.state<Params>(PARAMS_STATE)`): the `dashboardPage`
 * extension registers it; the form widgets (`textInput`, `checkboxGroup`) read and write their param in it.
 */
export const PARAMS_STATE = 'params';

/** The values of the page's form widgets by name, sent to ClickHouse as query parameters (`{path:String}`). */
export type Params = Readonly<Record<string, string>>;

/**
 * The params in the URL, `?wp=<JSON object of strings>` (none by default; a `wp` that is no such object is none); the
 * data handlers read them as they are.
 */
export const paramsState: QueryStateSpec<Params> = {
  keys: ['wp'],
  parse: (url) => parseParams(url.get('wp')),
  format: entriesOf,
  request: entriesOf,
};

/**
 * The page params of a widget's tab (`ctx.state`); throws without the extension that keeps them, so the widget shows
 * that error.
 */
export function paramsOf(state: Pick<QueryApi, 'state'>): QueryState<Params> {
  const params = state.state<Params>(PARAMS_STATE);
  if (!params) throw new Error(`No extension keeps the page params (the query state ${PARAMS_STATE})`);
  return params;
}

/** `params` with the param `name` set to `value`. */
export function withParam(params: Params, name: string, value: string): Params {
  return { ...params, [name]: value };
}

function entriesOf(params: Params): [string, string][] {
  return Object.keys(params).length > 0 ? [['wp', JSON.stringify(params)]] : [];
}

function parseParams(text: string | null): Params {
  try {
    const parsed: unknown = JSON.parse(text ?? '{}');
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  } catch {
    return {};
  }
}
