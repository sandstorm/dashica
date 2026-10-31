import { queryKey } from '../../hosts/query/query';

/** The values of the page's form widgets by name, sent to ClickHouse as query parameters (`{path:String}`). */
export type Params = Readonly<Record<string, string>>;

/**
 * The page params of a tab's query state (`ctx.query.get(PARAMS)`): the form widgets (`textInput`, `checkboxGroup`)
 * read and write their param in it. In the URL, `?wp=<JSON object of strings>` (none by default; a `wp` that is no
 * such object is none); the data handlers read them as they are.
 */
export const PARAMS = queryKey<Params>('wp', {
  parse: (url) => parseParams(url.get('wp')),
  format: entriesOf,
  sentToServer: true,
});

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
