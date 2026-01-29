
import "./index.css";

import Alpine from '@alpinejs/csp'
import intersect from '@alpinejs/intersect'

import filterButton from './components/filterButton'
import searchBar from './components/searchBar'
import timeBar from './components/timeBar'
import {timeBar as timeBarChart} from './chart/timeBar'
import {barVertical as barVerticalChart} from './chart/barVertical'
import {barHorizontal as barHorizontalChart} from './chart/barHorizontal'
import {timeHeatmap as timeHeatmapChart} from './chart/timeHeatmap'
import {timeHeatmapOrdinal as timeHeatmapOrdinalChart} from './chart/timeHeatmapOrdinal'
import {stats as statsChart} from './chart/stats'
import {clickhouseFactory} from './legacy/clickhouse'
import "./store"

Alpine.plugin(intersect);

Alpine.data('filterButton', filterButton);
Alpine.data('searchBar', searchBar);
Alpine.data('timeBar', timeBar);


Alpine.start()
window.Alpine = Alpine

window.exports = Alpine.reactive({});

Alpine.data('legacyInlinePlaceholder', (placeholderName) => ({
    init() {
        Alpine.effect(() => {
            console.log("Rendering", placeholderName, "with component", window.exports[placeholderName])
            const domNodeToRender = window.exports[placeholderName];
            if (!domNodeToRender) {
                return console.warn(
                    "Legacy component", placeholderName, "not found. Did you forget to export it?"
                );
            }

            if (domNodeToRender.then) {
                domNodeToRender.then(domNode => {
                    this.$el.innerHTML = "";
                    if (domNode) {
                        this.$el.appendChild(domNode);
                    }
                })
            } else {
                this.$el.innerHTML = "";
                if (domNodeToRender) {
                    this.$el.appendChild(domNodeToRender);
                }

            }
        })
    }
}));

window.LegacyScriptWrapper = function(baseUrl, innerScript) {

    // recompute window.exports.[value] if one of the charts change.
    Alpine.effect(function() {
        const filters = Alpine.store('urlState').getCombinedFilter();

        const chart = {
            timeBar: timeBarChart,
            barVertical: barVerticalChart,
            barHorizontal: barHorizontalChart,
            timeHeatmap: timeHeatmapChart,
            timeHeatmapOrdinal: timeHeatmapOrdinalChart,
            stats: statsChart,
        };

        const visibility = () => Promise.resolve(true); // TODO: we disable intersection observing for now

        const clickhouse = clickhouseFactory(baseUrl);

        const viewOptions = [];
        const invalidation = new Promise(() => {});

        innerScript({chart, visibility, clickhouse, filters, viewOptions, invalidation, exports: window.exports});
    })

}