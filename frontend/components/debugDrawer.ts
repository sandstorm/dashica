import Alpine from '@alpinejs/csp';
import {table} from '../chart/table';
import { instance as Viz } from '@viz-js/viz';

Alpine.data('debugDrawer', () => ({

    visible: false,

    async renderDotGraph(dotSource, container) {
        try {
            const viz = await Viz();
            const svg = await viz.renderSVGElement(dotSource);

            // Style the SVG for better visibility
            svg.setAttribute('width', '100%');
            svg.setAttribute('height', 'auto');
            svg.style.maxWidth = '100%';

            // Clear container and add SVG
            container.innerHTML = '';
            container.appendChild(svg);
        } catch (error) {
            console.error('Failed to render DOT graph:', error);
            container.innerHTML = `<pre class="bg-base-300 p-4 rounded overflow-x-auto text-sm font-mono">${dotSource}</pre>`;
        }
    },

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

                    // Display EXPLAIN PLAN
                    if (debugInfo.explainPlan && this.$refs.explainPlanText) {
                        this.$refs.explainPlanText.textContent = debugInfo.explainPlan;
                    }

                    // Display EXPLAIN PIPELINE (graph)
                    if (debugInfo.explainPipeline && this.$refs.explainPipelineContainer) {
                        const pipelineText = debugInfo.explainPipeline;

                        // Check if it's a DOT graph
                        if (pipelineText.trim().startsWith('digraph')) {
                            // Render as SVG graph (as-is from ClickHouse)
                            this.renderDotGraph(pipelineText, this.$refs.explainPipelineContainer);
                        } else {
                            // Display as plain text
                            this.$refs.explainPipelineContainer.innerHTML = `<pre class="bg-base-300 p-4 rounded overflow-x-auto text-sm font-mono">${pipelineText}</pre>`;
                        }
                    }

                    // Display EXPLAIN PIPELINE (detailed text)
                    if (debugInfo.explainPipelineText && this.$refs.explainPipelineDetailText) {
                        this.$refs.explainPipelineDetailText.textContent = debugInfo.explainPipelineText;
                    }

                    // Display EXPLAIN SYNTAX
                    if (debugInfo.explainSyntax && this.$refs.explainSyntaxText) {
                        this.$refs.explainSyntaxText.textContent = debugInfo.explainSyntax;
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