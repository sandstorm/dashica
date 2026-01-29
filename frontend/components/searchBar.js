import flatpickr from 'flatpickr';

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

    init() {
        this.initFlatpickr();

        // Set flatpickr date if custom range is loaded from URL
        if (this.$store.urlState.customDateRange) {
            const dates = this.$store.urlState.customDateRange.split(' to ');
            if (this.flatpickrInstance) {
                this.flatpickrInstance.setDate(dates);
            }
        }
    },

    initFlatpickr() {
        this.flatpickrInstance = flatpickr(this.$refs.datePicker, {
            mode: 'range',
            dateFormat: 'Y-m-d H:i',
            enableTime: true,
            time_24hr: true,
            onChange: (selectedDates, dateStr) => {
                this.$store.urlState.setCustomDateRange(dateStr);
            }
        });
    },

    openCustomDatePicker() {
        this.$store.urlState.timeRange = 'custom';

        setTimeout(() => {
            this.flatpickrInstance.open();
        }, 100);

        if (this.$store.urlState.autoRefresh) {
            this.$store.urlState.autoRefresh = false;
        }
    },
})