import { resolveScope } from '../store';

export default () => ({
    name: '',
    options: [],
    _scope: null,

    init() {
        this.name = this.$el.dataset.name;
        this._scope = resolveScope(this.$el);
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
        if (this._scope && this._scope.widgetParams[this.name] === undefined) {
            this._scope.setWidgetParam(this.name, JSON.stringify(defaults));
        }
    },

    isChecked(option) {
        try {
            const cur = JSON.parse(this._scope?.widgetParams[this.name] || '[]');
            return cur.includes(option);
        } catch {
            return false;
        }
    },

    toggle(event, option) {
        let cur = [];
        try {
            cur = JSON.parse(this._scope?.widgetParams[this.name] || '[]');
        } catch {}
        const next = event.target.checked
            ? [...cur, option]
            : cur.filter(v => v !== option);
        this._scope?.setWidgetParam(this.name, JSON.stringify(next));
    },
});
