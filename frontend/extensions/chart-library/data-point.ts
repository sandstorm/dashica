// See dataPointOf.
import type { DataPoint, QueryResult } from '../../hosts/widgets/widgets';
import { pillValue } from '../widget-library/clickhouse-type';

/**
 * The data point of a click on `value` in the column `column` (a chart's mark, a table's cell), with the column's
 * ClickHouse type of `types` (the answer's `columnTypesOf`): a time as ISO 8601 in UTC, a day as its date
 * (`pillValue`), anything else as text; without a type its text, without a type.
 */
export function dataPointOf(column: string, value: unknown, types: ColumnTypes): DataPoint {
  const type = types[column];
  return { field: column, value: pillValue(value, type), ...(type ? { type } : {}) };
}

/** The ClickHouse type of each column by its name (`{timestamp: 'DateTime'}`). */
export type ColumnTypes = Readonly<Record<string, string>>;

/**
 * The ClickHouse type of each column of `result` (X-Dashica-Column-Types, percent-encoded as it carries any text), as
 * the query has it before the Arrow casts (a `DateTime` arrives as seconds); empty when the server sent none.
 */
export function columnTypesOf({ headers }: Pick<QueryResult, 'headers'>): ColumnTypes {
  return JSON.parse(decodeURIComponent(headers.get('X-Dashica-Column-Types') || '{}'));
}
