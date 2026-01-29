
import "./index.css";

import Alpine from '@alpinejs/csp'
import intersect from '@alpinejs/intersect'

import filterButton from './components/filterButton'
import searchBar from './components/searchBar'
import timeBar from './components/timeBar'
import {timeBar as timeBarChart} from './chart/timeBar'
import {barVertical as barVerticalChart} from './chart/barVertical'
import {clickhouseFactory} from './legacy/clickhouse'
import "./store"

Alpine.plugin(intersect);

Alpine.data('filterButton', filterButton);
Alpine.data('searchBar', searchBar);
Alpine.data('timeBar', timeBar);


Alpine.start()
window.Alpine = Alpine

window.exports = Alpine.reactive({});

window.LegacyScriptWrapper = function(baseUrl, innerScript) {
    const wrappingDomNode = document.createElement('div');

    Alpine.effect(function() {
        const filters = Alpine.store('urlState').getCombinedFilter();

        const chart = {
            timeBar: timeBarChart,
            barVertical: barVerticalChart,
        };

        const visibility = () => Promise.resolve(true); // TODO: we disable intersection observing for now

        const clickhouse = clickhouseFactory(baseUrl);

        const viewOptions = [];
        const invalidation = new Promise(() => {});

        innerScript({chart, visibility, clickhouse, filters, viewOptions, invalidation, exports: window.exports});
    })

}