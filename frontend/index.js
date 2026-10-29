// UNMIGRATED (workbench): port, rewrite or delete, then remove this line. See docs/2026-10-28-workbench.md §5.

import "./index.css";
import "./tabulator-theme.css";

import { createWorkbench } from './workbench/workbench';
import { searchEverywhere } from './extensions/search-everywhere/search-everywhere';

// The page's inline script calls initWorkbench().
window.Dashica = window.Dashica || {};
window.Dashica.initWorkbench = () => {
    const host = document.getElementById('workbench');
    if (!host) return;
    createWorkbench(host, {
        content: document.querySelector('[data-workbench-part="content"]'),
        extensions: [searchEverywhere],
    });
};
