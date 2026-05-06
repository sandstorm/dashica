
import "./index.css";
import "./tabulator-theme.css";

import Alpine from '@alpinejs/csp'
import intersect from '@alpinejs/intersect'
import resize from '@alpinejs/resize'

import filterButton from './components/filterButton'
import searchBar from './components/searchBar'
import textInput from './components/textInput'
import checkboxGroup from './components/checkboxGroup'
import speedscopeLink from './components/speedscopeLink'
import "./store"
import "./components/chart";
import "./components/debugDrawer";
import "./components/sidebar";
import favorites from './components/favorites';

Alpine.plugin(intersect);
Alpine.plugin(resize);

Alpine.data('filterButton', filterButton);
Alpine.data('searchBar', searchBar);
Alpine.data('textInput', textInput);
Alpine.data('checkboxGroup', checkboxGroup);
Alpine.data('speedscopeLink', speedscopeLink);
Alpine.data('favorites', favorites);


window.Alpine = Alpine
