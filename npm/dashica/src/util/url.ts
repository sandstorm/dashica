/**
 * Replace (or remove) a single query-param in the current URL without reloading.
 * Passing `null`/`undefined` removes the param.
 */
export function replaceStateParam(
    key: string,
    value?: string | number | null
): void {
    const params = new URLSearchParams(window.location.search);

    if (value === null || value === undefined) {
        params.delete(key);
    } else {
        params.set(key, String(value));
    }

    const qs = params.toString();
    history.replaceState(
        {},
        '',
        window.location.pathname + (qs ? `?${qs}` : '')
    );
}

/**
 * Push a new history entry that differs by one query-param.
 * Passing `null`/`undefined` removes the param.
 */
export function pushStateParam(
    key: string,
    value?: string | null
): void {
    const params = new URLSearchParams(window.location.search);

    if (value === null || value === undefined) {
        params.delete(key);
    } else {
        params.set(key, value);
    }

    const qs = params.toString();
    history.pushState(
        {},
        '',
        window.location.pathname + (qs ? `?${qs}` : '')
    );
}

/**
 * Read a single query-param from the current URL.
 * Returns `null` if the param is absent.
 */
export function getStateParam(key: string): string | null {
    return new URLSearchParams(window.location.search).get(key);
}
