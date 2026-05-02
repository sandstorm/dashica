import Alpine from '@alpinejs/csp';

function debounce(func, timeout = 300){
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => { func.apply(this, args); }, timeout);
    };
}

// Shared store for URL state management
Alpine.store('urlState', {
    // State
    sqlFilter: '',
    timeRange: '24h',
    customDateRange: '',
    autoRefresh: false,
    refreshInterval: 30,
    logScale: false,
    widgetParams: {} as Record<string, string>,

    init() {
        this._loadFromUrl();
        window.addEventListener('popstate', () => this._loadFromUrl());
        window.addEventListener('dashica-add-filter', (e) => {
            this.addFilter(e.detail);
        });
        window.addEventListener('dashica-set-time', (e: any) => {
            const {from, to} = e.detail;
            this.setCustomTime(from, to);
        });

        const debouncedUpdateUrlAndTriggerRefresh = debounce(() => {
            this._updateUrl();
        }, 200);

        Alpine.effect(() => {
            // reading these values sets up listeners, see https://alpinejs.dev/advanced/reactivity#alpine-effect
            this.sqlFilter;
            this.timeRange;
            this.customDateRange;
            this.autoRefresh;
            // deep-read widgetParams so we re-fire when individual entries change
            JSON.stringify(this.widgetParams);
            debouncedUpdateUrlAndTriggerRefresh();
        });

        // Handle refreshing
        let refreshTimer = null;
        Alpine.effect(() => {
            if (refreshTimer) clearInterval(refreshTimer);
            // reading these values sets up listeners, see https://alpinejs.dev/advanced/reactivity#alpine-effect
            if (this.autoRefresh) {
                window.setInterval(() => this._triggerRefresh(), this.refreshInterval * 1000);
            }
        });
    },

    getCombinedFilter() {
        return {
            timeRange: this.timeRange,
            customTimeRange: this.customDateRange,
            sqlFilter: this.sqlFilter,
        }
    },

    setCustomTime(from: Date, to: Date) {
        const pad = (n: number) => String(n).padStart(2, '0');
        const fmt = (d: Date) =>
            `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        this.timeRange = 'custom';
        this.customDateRange = `${fmt(from)} to ${fmt(to)}`;
    },

    setSqlFilter(value) {
        this.sqlFilter = value;
    },

    setWidgetParam(name: string, value: string) {
        // Replace the whole map so Alpine sees a reference change for nested-key reactivity.
        this.widgetParams = { ...this.widgetParams, [name]: value };
    },

    getWidgetParam(name: string, fallback = ''): string {
        const v = this.widgetParams[name];
        return v === undefined ? fallback : v;
    },


    _updateUrl() {
        const params = new URLSearchParams();

        if (this.sqlFilter) params.set('sql', this.sqlFilter);
        if (this.timeRange !== '24h') params.set('time', this.timeRange);
        if (this.timeRange === 'custom' && this.customDateRange) {
            params.set('range', this.customDateRange);
        }
        if (this.autoRefresh) params.set('refresh', this.refreshInterval.toString());
        if (this.logScale) params.set('log', '1');
        if (Object.keys(this.widgetParams).length > 0) {
            params.set('wp', JSON.stringify(this.widgetParams));
        }

        const newUrl = params.toString() ? `?${params.toString()}` : window.location.pathname;
        window.history.pushState({}, '', newUrl);
    },

    _loadFromUrl() {
        const params = new URLSearchParams(window.location.search);

        this.sqlFilter = params.get('sql') || '';
        this.timeRange = params.get('time') || '24h';
        this.customDateRange = params.get('range') || '';

        this.logScale = params.get('log') === '1';

        const wp = params.get('wp');
        if (wp) {
            try {
                this.widgetParams = JSON.parse(wp);
            } catch {
                this.widgetParams = {};
            }
        } else {
            this.widgetParams = {};
        }

        const refresh = params.get('refresh');
        if (refresh) {
            this.autoRefresh = true;
            this.refreshInterval = parseInt(refresh);
        } else {
            this.autoRefresh = false;
        }
    },

    // Helper to dispatch refresh event
    _triggerRefresh() {
        window.dispatchEvent(new CustomEvent('dashboard-refresh', {
            detail: {
                sqlFilter: this.sqlFilter,
                timeRange: this.timeRange,
                customDateRange: this.customDateRange
            }
        }));
    },

    toggleAutoRefresh() {
        this.autoRefresh = !this.autoRefresh;
    },

    // Helper methods for common operations
    setTimePreset(presetValue) {
        this.timeRange = presetValue;
    },

    setCustomDateRange(dateStr) {
        this.customDateRange = dateStr;
    },

    clearSqlFilter() {
        this.sqlFilter = '';
    },

    toggleLogScale() {
        this.logScale = !this.logScale;
    },

    addFilter(queryPart) {
        if (this.sqlFilter) {
            this.sqlFilter += ' \nAND ' + queryPart;
        } else {
            this.sqlFilter = queryPart;
        }
    }
});
