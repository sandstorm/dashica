// See candidateOf.
import type { QueryResult } from '../../hosts/widgets/widgets';
import type { FilterCandidate } from '../filter-library/offer';
import { pillValue } from '../widget-library/clickhouse-type';

/**
 * The candidate of a click on `value` in the column `column` (a chart's mark, a table's cell), with the column's
 * ClickHouse type of `types` (the answer's `dashicaColumnTypes`): a time as ISO 8601 in UTC, a day as its date
 * (`pillValue`), anything else as text; without a type its text, offered as text.
 */
export function candidateOf(column: string, value: unknown, types: QueryResult['dashicaColumnTypes']): FilterCandidate {
  const type = types?.[column];
  return { fieldId: column, value: pillValue(value, type), ...(type ? { type } : {}) };
}
