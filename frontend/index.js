
import "./index.css";

import Alpine from '@alpinejs/csp'
import intersect from '@alpinejs/intersect'

import filterButton from './components/filterButton'
import searchBar from './components/searchBar'
import timeBar from './components/timeBar'
import {timeBar as timeBarChart} from './chart/timeBar'
import {clickhouseFactory} from './legacy/clickhouse'

Alpine.plugin(intersect)

Alpine.data('filterButton', filterButton);
Alpine.data('searchBar', searchBar);
Alpine.data('timeBar', timeBar);

Alpine.start()
window.Alpine = Alpine
window.LegacyScriptWrapper = function(baseUrl, innerScript) {
    console.log("BaseURL", baseUrl);

    const chart = {
        timeBar: timeBarChart
    };

    const visibility = () => Promise.resolve(true); // TODO: we disable intersection observing for now

    const filters = {}; // TODO: Filter support

    const clickhouse = clickhouseFactory(baseUrl);

    innerScript({chart, visibility, clickhouse, filters});
}