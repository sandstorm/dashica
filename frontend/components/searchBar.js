import flatpickr from 'flatpickr';

export default () => ({
    sqlFilter: '',
    timeRange: 'last24h',
    customDateRange: '',
    autoRefresh: false,
    refreshInterval: 30,
    countdown: 0,
    lastRefresh: false,

    timePresets: [
        {label: '5m', value: 'last5m'},
        {label: '15m', value: 'last15m'},
        {label: '1h', value: 'last1h'},
        {label: '3h', value: 'last3h'},
        {label: '6h', value: 'last6h'},
        {label: '12h', value: 'last12h'},
        {label: '24h', value: 'last24h'},
        {label: '2d', value: 'last2d'},
        {label: '7d', value: 'last7d'},
        {label: '30d', value: 'last30d'},
    ],

    refreshTimer: null,
    countdownTimer: null,
    debounceTimer: null,
    flatpickrInstance: null,

    init() {
        this.loadFromUrl();
        this.initFlatpickr();
        window.addEventListener('popstate', () => this.loadFromUrl());
    },

    initFlatpickr() {
        this.flatpickrInstance = flatpickr(this.$refs.datePicker, {
            mode: 'range',
            dateFormat: 'Y-m-d H:i',
            enableTime: true,
            time_24hr: true,
            onChange: (selectedDates, dateStr) => {
                this.customDateRange = dateStr;
                this.updateUrl();
                this.refreshData();
            }
        });
    },

    selectTimePreset(preset) {
        this.timeRange = preset.value;
        this.updateUrl();

        this.refreshData();
    },

    openCustomDatePicker() {
        this.timeRange = 'custom';
        this.updateUrl();

        setTimeout(() => {
            this.flatpickrInstance.open();
        }, 100);

        if (this.autoRefresh) {
            this.autoRefresh = false;
            this.toggleAutoRefresh();
        }
    },

    toggleAutoRefresh() {
        if (this.autoRefresh) {
            this.startAutoRefresh();
        } else {
            this.stopAutoRefresh();
        }
        this.updateUrl();
    },

    restartAutoRefresh() {
        if (this.autoRefresh) {
            this.stopAutoRefresh();
            this.startAutoRefresh();
        }
        this.updateUrl();
    },

    startAutoRefresh() {
        this.countdown = this.refreshInterval;

        this.countdownTimer = setInterval(() => {
            this.countdown--;
            if (this.countdown <= 0) {
                this.refreshData();
                this.countdown = this.refreshInterval;
            }
        }, 1000);
    },

    stopAutoRefresh() {
        if (this.countdownTimer) {
            clearInterval(this.countdownTimer);
            this.countdownTimer = null;
        }
        this.countdown = 0;
    },

    refreshData() {
        console.log('🔄 Refreshing data:', {
            sql: this.sqlFilter,
            timeRange: this.timeRange,
            customRange: this.customDateRange
        });

        // Show toast notification
        this.lastRefresh = true;
        setTimeout(() => {
            this.lastRefresh = false;
        }, 3000);

        window.dispatchEvent(new CustomEvent('dashboard-refresh', {
            detail: {
                sqlFilter: this.sqlFilter,
                timeRange: this.timeRange,
                customDateRange: this.customDateRange
            }
        }));
    },

    autoGrow(element) {
        element.style.height = 'auto';
        element.style.height = Math.min(element.scrollHeight, 200) + 'px';
        //element.style.minHeight = Math.min(element.scrollHeight, 50) + 'px';
    },

    debouncedUpdateUrl() {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            this.updateUrl();
        }, 500);
    },

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

    loadFromUrl() {
        const params = new URLSearchParams(window.location.search);

        this.sqlFilter = params.get('sql') || '';
        this.timeRange = params.get('time') || 'last24h';
        this.customDateRange = params.get('range') || '';

        const refresh = params.get('refresh');
        if (refresh) {
            this.autoRefresh = true;
            this.refreshInterval = parseInt(refresh);
            this.startAutoRefresh();
        }

        if (this.timeRange === 'custom' && this.customDateRange) {
            const dates = this.customDateRange.split(' to ');
            if (this.flatpickrInstance) {
                this.flatpickrInstance.setDate(dates);
            }
        }

        this.$nextTick(() => {
            const textarea = document.getElementById('sqlFilter');
            if (textarea) this.autoGrow(textarea);
        });
    }
})