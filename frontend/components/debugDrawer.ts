import Alpine from '@alpinejs/csp';
import {table} from '../chart/table';

Alpine.data('debugDrawer', () => ({

    visible: false,

    init() {
        this.$el.addEventListener('dashica-debugDrawer-toggle', async (e) => {
            this.visible = !this.visible

            if (this.visible) {
                // Display debug info (query + explain)
                if (e.detail?.debugInfo) {
                    const debugInfo = e.detail.debugInfo;

                    // Display query
                    if (debugInfo.query && this.$refs.queryText) {
                        this.$refs.queryText.textContent = debugInfo.query;
                    }

                    // Display explain
                    if (debugInfo.explain && this.$refs.explainText) {
                        this.$refs.explainText.textContent = JSON.stringify(debugInfo.explain, null, 2);
                    }

                    // Display stats
                    if (debugInfo.stats && this.$refs.statsText) {
                        this.$refs.statsText.textContent = JSON.stringify(debugInfo.stats, null, 2);
                    }
                }

                // Display query results as a table
                if (e.detail?.queryResult && this.$refs.resultsTableContainer) {
                    try {
                        // Clear previous table
                        this.$refs.resultsTableContainer.innerHTML = '';

                        // Create new table with query results
                        const tableElement = table(e.detail.queryResult, {
                            height: 400
                        });
                        this.$refs.resultsTableContainer.appendChild(tableElement);
                    } catch (error) {
                        console.error('Failed to render results table:', error);
                        this.$refs.resultsTableContainer.innerHTML = `<p class="text-error">Failed to render table: ${error.message}</p>`;
                    }
                }

                // Legacy: Display clickhouse summary
                if (e.detail?.queryResult?.clickhouseSummary && this.$refs.clickhouseSummary) {
                    this.$refs.clickhouseSummary.innerText = JSON.stringify(e.detail?.queryResult?.clickhouseSummary, null, '    ');
                }
            }
        });
    },
}))