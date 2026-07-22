import { getCombinedFilter, resolveScope } from '../store';

export default () => ({
    widgetBaseUrl: '',

    init() {
        this.widgetBaseUrl = this.$el.dataset.widgetBaseUrl;
    },

    href() {
        const wp = resolveScope(this.$el)?.widgetParams ?? {};
        const f = getCombinedFilter(this.$el);
        const u = new URLSearchParams();
        u.set('filters', JSON.stringify(f));
        if (Object.keys(wp).length > 0) {
            u.set('params', JSON.stringify(wp));
        }
        const target = window.location.origin + this.widgetBaseUrl + '/speedscope-query?' + u.toString();
        return window.location.origin + this.widgetBaseUrl + '/viewer/#profileURL=' + encodeURIComponent(target);
    },
});
