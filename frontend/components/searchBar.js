import flatpickr from 'flatpickr';
import { resolveScope } from '../store';

export default () => ({
    timePresets: [
        // value: is parsed by https://pkg.go.dev/time#ParseDuration
        {label: '5m', value: '5m'},
        {label: '15m', value: '15m'},
        {label: '1h', value: '1h'},
        {label: '3h', value: '3h'},
        {label: '6h', value: '6h'},
        {label: '12h', value: '12h'},
        {label: '24h', value: '24h'},
        {label: '2d', value: '48h'},
        {label: '7d', value: '168h'},
        {label: '30d', value: '720h'},
    ],

    flatpickrInstance: null,
    // The nearest filter scope — where SQL-filter state lives (per-dashboard),
    // as opposed to the global $store.timeState (time range / refresh / log).
    _scope: null,

    // Whether the SQL-filter panel (SqlFilterPanel) is expanded. Bound reactively
    // via x-show / @click in the shared SqlFilterToggle/SqlFilterPanel templ
    // components — used identically by the dashboard bar and Explore's strip.
    filtersOpen: false,

    init() {
        this._scope = resolveScope(this.$el);
        this.initFlatpickr();

        // Set flatpickr date if custom range is loaded from URL
        if (this.$store.timeState.customDateRange) {
            const dates = this.$store.timeState.customDateRange.split(' to ');
            if (this.flatpickrInstance) {
                this.flatpickrInstance.setDate(dates);
            }
        }
    },

    // --- filter state, resolved from the nearest scope ---
    get sqlFilter() {
        return this._scope?.sqlFilter ?? '';
    },
    setSqlFilter(value) {
        this._scope?.setSqlFilter(value);
    },
    clearSqlFilter() {
        this._scope?.clearSqlFilter();
    },
    addFilter(queryPart) {
        this._scope?.addFilter(queryPart);
    },

    initFlatpickr() {
        this.flatpickrInstance = flatpickr(this.$refs.datePicker, {
            mode: 'range',
            dateFormat: 'Y-m-d H:i',
            enableTime: true,
            time_24hr: true,
            onChange: (selectedDates, dateStr) => {
                this.$store.timeState.setCustomDateRange(dateStr);
            }
        });
    },

    refreshData() {
        this.$store.timeState._triggerRefresh();
    },

    openCustomDatePicker() {
        this.$store.timeState.timeRange = 'custom';

        setTimeout(() => {
            this.flatpickrInstance.open();
        }, 100);

        if (this.$store.timeState.autoRefresh) {
            this.$store.timeState.autoRefresh = false;
        }
    },
})
