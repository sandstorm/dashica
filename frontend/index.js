
import "./index.css";

import Alpine from '@alpinejs/csp'
import intersect from '@alpinejs/intersect'

import filterButton from './components/filterButton'
import searchBar from './components/searchBar'
import timeBar from './components/timeBar'

Alpine.plugin(intersect)

Alpine.data('filterButton', filterButton);
Alpine.data('searchBar', searchBar);
Alpine.data('timeBar', timeBar);

Alpine.start()
window.Alpine = Alpine