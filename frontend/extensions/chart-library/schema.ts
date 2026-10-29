import type { ChannelValueSpec } from '@observablehq/plot';
import type { Table } from 'apache-arrow';

/**
 * The columns of a query result, to name a missing one in a chart's error: "x: the configured column time does not
 * exist in the data. Detected columns in data: bucket, cnt".
 */
export class SchemaAnalyzer {
  readonly #columnNames: string[];

  constructor(data: Table) {
    this.#columnNames = data.schema.fields.map((field) => field.name);
  }

  /** `property` when it names a column of the data, or is no column name (a function, a constant); throws otherwise. */
  requiredColumn(property: ChannelValueSpec | undefined, pathForErrorMessage: string = String(property)): ChannelValueSpec {
    if (property !== undefined && typeof property !== 'string') return property;
    if (!property) throw new Error(`${pathForErrorMessage}: not configured. Detected columns in data: ${this.#columnNames.join(', ')}`);
    if (!this.#columnNames.includes(property)) {
      throw new Error(`${pathForErrorMessage}: the configured column ${property} does not exist in the data. Detected columns in data: ${this.#columnNames.join(', ')}`);
    }
    return property;
  }
}
