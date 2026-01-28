
import "./index.css";

import Alpine from '@alpinejs/csp'
import intersect from '@alpinejs/intersect'

import filterButton from './components/filterButton'
import searchBar from './components/searchBar'
import timeBar from './components/timeBar'
import {timeBar as timeBarChart} from './chart/timeBar'
import * as clickhouse from './legacy/clickhouse'

Alpine.plugin(intersect)

Alpine.data('filterButton', filterButton);
Alpine.data('searchBar', searchBar);
Alpine.data('timeBar', timeBar);

Alpine.start()
window.Alpine = Alpine
window.LegacyScriptWrapper = function(innerScript) {
    const chart = {
        timeBar: timeBarChart
    };

    const visibility = () => Promise.resolve(true); // TODO: we disable intersection observing for now

    const filters = {}; // TODO: Filter support

    innerScript({chart, visibility, clickhouse, filters});
}