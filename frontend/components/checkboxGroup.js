export default () => ({
    name: '',
    options: [],

    init() {
        this.name = this.$el.dataset.name;
        try {
            this.options = JSON.parse(this.$el.dataset.options || '[]');
        } catch {
            this.options = [];
        }
        let defaults = [];
        try {
            defaults = JSON.parse(this.$el.dataset.default || '[]');
        } catch {}
        // Seed default selection synchronously so charts that fire on first paint
        // already see the param.
        if (this.$store.urlState.widgetParams[this.name] === undefined) {
            this.$store.urlState.setWidgetParam(this.name, JSON.stringify(defaults));
        }
    },

    isChecked(option) {
        try {
            const cur = JSON.parse(this.$store.urlState.widgetParams[this.name] || '[]');
            return cur.includes(option);
        } catch {
            return false;
        }
    },

    toggle(event, option) {
        let cur = [];
        try {
            cur = JSON.parse(this.$store.urlState.widgetParams[this.name] || '[]');
        } catch {}
        const next = event.target.checked
            ? [...cur, option]
            : cur.filter(v => v !== option);
        this.$store.urlState.setWidgetParam(this.name, JSON.stringify(next));
    },
});
