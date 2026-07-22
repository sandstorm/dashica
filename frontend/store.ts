import Alpine from '@alpinejs/csp';

function debounce(func, timeout = 300){
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => { func.apply(this, args); }, timeout);
    };
}

// ---------------------------------------------------------------------------
// URL sync — single source of truth for the query string.
//
// The URL is split between two owners that touch DISJOINT keys, so each can
// read-modify-write the same URLSearchParams without clobbering the other:
//   - timeState  (global):      time / range / refresh / log
//   - FilterScope (per-scope):  sql / wp
// A commit only pushes a history entry when the string actually changed, so
// the initial-load effects produce zero spurious entries.
// ---------------------------------------------------------------------------
function updateUrl(mutate: (p: URLSearchParams) => void) {
    const params = new URLSearchParams(window.location.search);
    mutate(params);
    const next = params.toString();
    const current = window.location.search.replace(/^\?/, '');
    if (next === current) return;
    window.history.pushState({}, '', next ? `?${next}` : window.location.pathname);
}

// ---------------------------------------------------------------------------
// Global time/display state — identical on every open dashboard (a workspace
// of combined dashboards compares them over the same window). One instance.
// ---------------------------------------------------------------------------
Alpine.store('timeState', {
    timeRange: '24h',
    customDateRange: '',
    autoRefresh: false,
    refreshInterval: 30,
    logScale: false,
    _refreshNonce: 0,

    init() {
        this._loadFromUrl();
        window.addEventListener('popstate', () => this._loadFromUrl());
        window.addEventListener('dashica-set-time', (e: any) => {
            const {from, to} = e.detail;
            this.setCustomTime(from, to);
        });

        const debouncedUpdateUrl = debounce(() => {
            updateUrl((p) => this._writeParams(p));
        }, 200);

        Alpine.effect(() => {
            // reading these values sets up listeners, see https://alpinejs.dev/advanced/reactivity#alpine-effect
            this.timeRange;
            this.customDateRange;
            this.autoRefresh;
            this.refreshInterval;
            this.logScale;
            debouncedUpdateUrl();
        });

        // Handle refreshing
        let refreshTimer = null;
        Alpine.effect(() => {
            if (refreshTimer) clearInterval(refreshTimer);
            // reading these values sets up listeners, see https://alpinejs.dev/advanced/reactivity#alpine-effect
            if (this.autoRefresh) {
                refreshTimer = window.setInterval(() => this._triggerRefresh(), this.refreshInterval * 1000);
            }
        });
    },

    setCustomTime(from: Date, to: Date) {
        const pad = (n: number) => String(n).padStart(2, '0');
        const fmt = (d: Date) =>
            `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        this.timeRange = 'custom';
        this.customDateRange = `${fmt(from)} to ${fmt(to)}`;
    },

    _writeParams(params: URLSearchParams) {
        if (this.timeRange !== '24h') params.set('time', this.timeRange); else params.delete('time');
        if (this.timeRange === 'custom' && this.customDateRange) {
            params.set('range', this.customDateRange);
        } else {
            params.delete('range');
        }
        if (this.autoRefresh) params.set('refresh', this.refreshInterval.toString()); else params.delete('refresh');
        if (this.logScale) params.set('log', '1'); else params.delete('log');
    },

    _loadFromUrl() {
        const params = new URLSearchParams(window.location.search);
        this.timeRange = params.get('time') || '24h';
        this.customDateRange = params.get('range') || '';
        this.logScale = params.get('log') === '1';
        const refresh = params.get('refresh');
        if (refresh) {
            this.autoRefresh = true;
            this.refreshInterval = parseInt(refresh);
        } else {
            this.autoRefresh = false;
        }
    },

    _triggerRefresh() {
        this._refreshNonce++;
        window.dispatchEvent(new CustomEvent('dashboard-refresh', {
            detail: {timeRange: this.timeRange, customDateRange: this.customDateRange},
        }));
    },

    toggleAutoRefresh() {
        this.autoRefresh = !this.autoRefresh;
    },

    setTimePreset(presetValue) {
        this.timeRange = presetValue;
    },

    setCustomDateRange(dateStr) {
        this.customDateRange = dateStr;
    },

    toggleLogScale() {
        this.logScale = !this.logScale;
    },
});

// ---------------------------------------------------------------------------
// Filter scope — per-dashboard state that means different things on different
// dashboards (a WHERE clause references THAT dashboard's tables/columns).
// Owned by the DOM element carrying [data-filter-scope]; charts resolve their
// scope by containment (nearest ancestor), never by name.
// ---------------------------------------------------------------------------
export interface FilterScope {
    sqlFilter: string;
    widgetParams: Record<string, string>;
    setSqlFilter(value: string): void;
    clearSqlFilter(): void;
    addFilter(queryPart: string): void;
    setWidgetParam(name: string, value: string): void;
    getWidgetParam(name: string, fallback?: string): string;
}

const scopeRegistry = new WeakMap<Element, FilterScope>();

// resolveScope walks up from `el` to the nearest [data-filter-scope] element
// and returns its scope, or null when there is none (e.g. a chart rendered
// outside any dashboard scope — callers treat that as an empty filter).
export function resolveScope(el: Element | null): FilterScope | null {
    const root = el?.closest('[data-filter-scope]');
    return root ? (scopeRegistry.get(root) ?? null) : null;
}

// createFilterScope builds a reactive scope, registers it on `root`, seeds it
// from the URL and — when syncUrl is set (the single page-level scope) —
// mirrors sql/wp back into the URL and listens for the filter-add event
// bubbling up from widgets inside it. Workspace panels (later) create scopes
// with syncUrl:false; the shell mirrors only the focused tab.
export function createFilterScope(root: HTMLElement, opts: {syncUrl?: boolean} = {}): FilterScope {
    const scope: FilterScope = Alpine.reactive({
        sqlFilter: '',
        widgetParams: {} as Record<string, string>,

        setSqlFilter(value: string) {
            this.sqlFilter = value;
        },
        clearSqlFilter() {
            this.sqlFilter = '';
        },
        addFilter(queryPart: string) {
            this.sqlFilter = this.sqlFilter
                ? this.sqlFilter + ' \nAND ' + queryPart
                : queryPart;
        },
        setWidgetParam(name: string, value: string) {
            // Replace the whole map so Alpine sees a reference change for nested-key reactivity.
            this.widgetParams = {...this.widgetParams, [name]: value};
        },
        getWidgetParam(name: string, fallback = ''): string {
            const v = this.widgetParams[name];
            return v === undefined ? fallback : v;
        },
    });

    scopeRegistry.set(root, scope);

    // Filters bubble from the clicked cell/button to the owning scope root and
    // stop there — a table in dashboard A can never pollute dashboard B.
    root.addEventListener('dashica-add-filter', (e: any) => {
        e.stopPropagation();
        scope.addFilter(e.detail);
    });

    if (opts.syncUrl) {
        _loadScopeFromUrl(scope);
        window.addEventListener('popstate', () => _loadScopeFromUrl(scope));

        const debouncedUpdateUrl = debounce(() => {
            updateUrl((p) => {
                if (scope.sqlFilter) p.set('sql', scope.sqlFilter); else p.delete('sql');
                if (Object.keys(scope.widgetParams).length > 0) {
                    p.set('wp', JSON.stringify(scope.widgetParams));
                } else {
                    p.delete('wp');
                }
            });
        }, 200);

        Alpine.effect(() => {
            scope.sqlFilter;
            // deep-read so we re-fire when individual entries change
            JSON.stringify(scope.widgetParams);
            debouncedUpdateUrl();
        });
    }

    return scope;
}

function _loadScopeFromUrl(scope: FilterScope) {
    const params = new URLSearchParams(window.location.search);
    scope.sqlFilter = params.get('sql') || '';
    const wp = params.get('wp');
    if (wp) {
        try {
            scope.widgetParams = JSON.parse(wp);
        } catch {
            scope.widgetParams = {};
        }
    } else {
        scope.widgetParams = {};
    }
}

// getCombinedFilter merges the global time window with the nearest filter
// scope for the element `el` — the value charts send to their /query endpoint.
export function getCombinedFilter(el: Element | null) {
    const ts: any = Alpine.store('timeState');
    ts._refreshNonce; // track for Alpine reactivity — re-runs effect on manual/auto refresh
    const scope = resolveScope(el);
    return {
        timeRange: ts.timeRange,
        customTimeRange: ts.customDateRange,
        sqlFilter: scope?.sqlFilter ?? '',
    };
}
