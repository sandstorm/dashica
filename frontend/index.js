// UNMIGRATED (workbench): port, rewrite or delete, then remove this line. See docs/2026-10-28-workbench.md §5.

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
import { createWorkbench } from './workbench/workbench';
import { legacyPage } from './extensions/legacy-page/legacy-page';
import { searchEverywhere } from './extensions/search-everywhere/search-everywhere';

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


window.Alpine = Alpine

// The workbench must be assembled BEFORE window.Alpine.start(): it moves the
// server-rendered parts into its regions, and Alpine then walks them in place.
// The page's inline script calls initWorkbench() ahead of Alpine.start().
window.Dashica = window.Dashica || {};
window.Dashica.initWorkbench = () => {
    const host = document.getElementById('workbench');
    if (!host) return;
    createWorkbench(host, {
        content: document.querySelector('[data-workbench-part="content"]'),
        extensions: [legacyPage(document), searchEverywhere()],
    });
};
