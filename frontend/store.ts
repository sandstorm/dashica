import Alpine from '@alpinejs/csp';

// Shared store for URL state management
Alpine.store('urlState', {
    // State
    sqlFilter: '',
    timeRange: 'last24h',
    customDateRange: '',
    autoRefresh: false,
    refreshInterval: 30,

    // Initialize from URL
    init() {
        this.loadFromUrl();
        window.addEventListener('popstate', () => this.loadFromUrl());
        this.setupWatchers();
    },

    // Setup reactive watchers for automatic URL updates
    setupWatchers() {
        // Watch sqlFilter changes
        Alpine.effect(() => {
            const filter = this.sqlFilter;
            this.updateUrl();
        });

        // Watch timeRange changes
        Alpine.effect(() => {
            const range = this.timeRange;
            this.updateUrl();
        });

        // Watch customDateRange changes
        Alpine.effect(() => {
            const customRange = this.customDateRange;
            if (this.timeRange === 'custom') {
                this.updateUrl();
            }
        });

        // Watch autoRefresh changes
        Alpine.effect(() => {
            const refresh = this.autoRefresh;
            this.updateUrl();
        });

        // Watch refreshInterval changes
        Alpine.effect(() => {
            const interval = this.refreshInterval;
            if (this.autoRefresh) {
                this.updateUrl();
            }
        });
    },

    // Update URL with current state
    updateUrl() {
        const params = new URLSearchParams();

        if (this.sqlFilter) params.set('sql', this.sqlFilter);
        if (this.timeRange !== 'last24h') params.set('time', this.timeRange);
        if (this.timeRange === 'custom' && this.customDateRange) {
            params.set('range', this.customDateRange);
        }
        if (this.autoRefresh) params.set('refresh', this.refreshInterval.toString());

        const newUrl = params.toString() ? `?${params.toString()}` : window.location.pathname;
        window.history.pushState({}, '', newUrl);
    },

    // Load state from URL
    loadFromUrl() {
        const params = new URLSearchParams(window.location.search);

        // Temporarily disable watchers during bulk update
        const oldSqlFilter = this.sqlFilter;
        const oldTimeRange = this.timeRange;
        const oldCustomRange = this.customDateRange;
        const oldAutoRefresh = this.autoRefresh;
        const oldInterval = this.refreshInterval;

        this.sqlFilter = params.get('sql') || '';
        this.timeRange = params.get('time') || 'last24h';
        this.customDateRange = params.get('range') || '';

        const refresh = params.get('refresh');
        if (refresh) {
            this.autoRefresh = true;
            this.refreshInterval = parseInt(refresh);
        } else {
            this.autoRefresh = false;
        }
    },

    // Helper to dispatch refresh event
    triggerRefresh() {
        window.dispatchEvent(new CustomEvent('dashboard-refresh', {
            detail: {
                sqlFilter: this.sqlFilter,
                timeRange: this.timeRange,
                customDateRange: this.customDateRange
            }
        }));
    },

    // Helper methods for common operations
    setTimePreset(presetValue) {
        this.timeRange = presetValue;
        this.triggerRefresh();
    },

    setCustomDateRange(dateStr) {
        this.customDateRange = dateStr;
        this.triggerRefresh();
    },

    clearSqlFilter() {
        this.sqlFilter = '';
        this.triggerRefresh();
    },

    addFilter(queryPart) {
        if (this.sqlFilter) {
            this.sqlFilter += ' ' + queryPart;
        } else {
            this.sqlFilter = queryPart;
        }
        this.triggerRefresh();
    }
});
