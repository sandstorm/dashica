export default () => ({

    addFilter(sqlFilter) {
        if (sqlFilter.includes('...')) {
            const parameter = prompt("Parameter value");
            if (parameter) {
                sqlFilter = sqlFilter.replaceAll('...', parameter);
            }
        }
        window.dispatchEvent(new CustomEvent('dashica-add-filter', {detail: sqlFilter}));
    }
})