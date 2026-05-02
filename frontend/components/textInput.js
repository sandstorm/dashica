export default () => ({
    name: '',
    prependCaret: false,

    init() {
        this.name = this.$el.dataset.name;
        this.prependCaret = this.$el.dataset.prependCaret === 'true';
        // Seed the slot synchronously so charts that fire on first paint already
        // see the (empty) value as a defined param — otherwise ClickHouse rejects
        // queries that reference {<name>:String} with "Substitution is not set".
        if (this.$store.urlState.widgetParams[this.name] === undefined) {
            this.$store.urlState.setWidgetParam(this.name, '');
        }
    },

    displayValue() {
        const stored = this.$store.urlState.widgetParams[this.name] || '';
        if (this.prependCaret && stored.startsWith('^')) {
            return stored.substring(1);
        }
        return stored;
    },

    write(event) {
        const v = event.target.value;
        if (this.prependCaret) {
            this.$store.urlState.setWidgetParam(this.name, v === '' ? '' : '^' + v);
        } else {
            this.$store.urlState.setWidgetParam(this.name, v);
        }
    },
});
