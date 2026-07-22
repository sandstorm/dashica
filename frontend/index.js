
import "./index.css";
import "./tabulator-theme.css";

import Alpine from '@alpinejs/csp'
import intersect from '@alpinejs/intersect'
import resize from '@alpinejs/resize'

import filterButton from './components/filterButton'
import filterScope from './components/filterScope'
import searchBar from './components/searchBar'
import textInput from './components/textInput'
import checkboxGroup from './components/checkboxGroup'
import speedscopeLink from './components/speedscopeLink'
import "./store"
import "./components/chart";
import "./components/debugDrawer";
import "./components/sidebar";
import favorites from './components/favorites';
import sidebarSearch from './components/sidebarSearch';
import exploreEditor from './explore/editor';
import './explore/explore.css';

Alpine.plugin(intersect);
Alpine.plugin(resize);

Alpine.data('filterButton', filterButton);
Alpine.data('filterScope', filterScope);
Alpine.data('searchBar', searchBar);
Alpine.data('textInput', textInput);
Alpine.data('checkboxGroup', checkboxGroup);
Alpine.data('speedscopeLink', speedscopeLink);
Alpine.data('favorites', favorites);
Alpine.data('sidebarSearch', sidebarSearch);
Alpine.data('exploreEditor', exploreEditor);


window.Alpine = Alpine
