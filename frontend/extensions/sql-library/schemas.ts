import type { Schema } from '../../generated/zz_generated.dashica';

/**
 * Each connection's schema from `/schema.json`, asked once and shared by those who hold this store (the Schema view's
 * two views; a SQL editor's completion); a failed answer is forgotten, so the next `get` asks again. `/schema.json`
 * is part of Explore: it answers only with explore_enabled.
 */
export class Schemas {
  readonly #asked = new Map<string, Promise<Schema>>();

  /** The schema of `connection`, asked the first time; `refresh`: asked again, the server too. */
  get(connection: string, refresh = false): Promise<Schema> {
    const known = this.#asked.get(connection);
    if (known && !refresh) return known;
    const asking = fetchSchema(connection, refresh);
    this.#asked.set(connection, asking);
    asking.catch(() => {
      if (this.#asked.get(connection) === asking) this.#asked.delete(connection);
    });
    return asking;
  }

  /** The connections asked so far, those that failed left out. */
  get asked(): string[] {
    return [...this.#asked.keys()];
  }
}

/** What `/schema.json` answers for `connection`; `refresh`: the server asks ClickHouse again. A failed answer throws its text. */
export async function fetchSchema(connection: string, refresh = false): Promise<Schema> {
  const response = await fetch(`/schema.json?${new URLSearchParams({ connection, ...(refresh ? { refresh: '1' } : {}) })}`);
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
}
