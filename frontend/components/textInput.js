import { resolveScope } from '../store';

export default () => ({
    name: '',
    prependCaret: false,
    _scope: null,

    init() {
        this.name = this.$el.dataset.name;
        this.prependCaret = this.$el.dataset.prependCaret === 'true';
        this._scope = resolveScope(this.$el);
        // Seed the slot synchronously so charts that fire on first paint already
        // see the (empty) value as a defined param — otherwise ClickHouse rejects
        // queries that reference {<name>:String} with "Substitution is not set".
        if (this._scope && this._scope.widgetParams[this.name] === undefined) {
            this._scope.setWidgetParam(this.name, '');
        }
    },

    displayValue() {
        const stored = this._scope?.widgetParams[this.name] || '';
        if (this.prependCaret && stored.startsWith('^')) {
            return stored.substring(1);
        }
        return stored;
    },

    write(event) {
        const v = event.target.value;
        if (this.prependCaret) {
            this._scope?.setWidgetParam(this.name, v === '' ? '' : '^' + v);
        } else {
            this._scope?.setWidgetParam(this.name, v);
        }
    },
});
