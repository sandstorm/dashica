// UNMIGRATED (workbench): port, rewrite or delete, then remove this line. See docs/2026-10-28-workbench.md §5.
import { createFilterScope } from '../store';

// filterScope is the Alpine boundary for the single page-level filter scope.
// It stamps [data-filter-scope] (in templ) and, on init, creates the URL-syncing
// scope owned by its element — so every chart/searchBar/widget nested inside it
// resolves this scope by containment. Init runs before children (Alpine inits
// parents first), so descendant charts already find the scope when they mount.
export default () => ({
    init() {
        createFilterScope(this.$el, { syncUrl: true });
    },
});
