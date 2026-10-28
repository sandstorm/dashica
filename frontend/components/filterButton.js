// UNMIGRATED (workbench): port, rewrite or delete, then remove this line. See docs/2026-10-28-workbench.md §5.
export default () => ({

    addFilter(sqlFilter) {
        if (sqlFilter.includes('...')) {
            const parameter = prompt("Parameter value");
            if (parameter) {
                sqlFilter = sqlFilter.replaceAll('...', parameter);
            }
        }
        // Bubble to the owning [data-filter-scope] root (stops there), so the
        // filter lands on THIS dashboard's scope, not a global store.
        this.$dispatch('dashica-add-filter', sqlFilter);
    }
})
