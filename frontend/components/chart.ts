import Alpine from '@alpinejs/csp';

import {timeBar} from '../chart/timeBar'
import {barVertical} from '../chart/barVertical'
import {barHorizontal} from '../chart/barHorizontal'
import {timeHeatmap} from '../chart/timeHeatmap'
import {timeHeatmapOrdinal} from '../chart/timeHeatmapOrdinal'
import {stats} from '../chart/stats'
import {query} from "./util/clickhouse-new";

const charts = {
    timeBar,
    barVertical,
    barHorizontal,
    timeHeatmap,
    timeHeatmapOrdinal,
    stats
}

Alpine.data('chart', () => ({
    init() {
        const chartType = this.$el.dataset.chartType;
        const widgetBaseUrl = this.$el.dataset.widgetBaseUrl;
        const chartProps = JSON.parse(this.$el.dataset.chartProps);

        const resultContainer = Alpine.reactive({});

        Alpine.effect(async () => {
            try {
                resultContainer.result = await query(widgetBaseUrl + "/query", this.$store.urlState.getCombinedFilter())
            } catch (e) {
                this.$el.innerHTML = `<b>ERROR: ${e.message}</b>`;
                throw e
            }
        });
        // we use a separate Alpine.effect here, to not reload the result if e.g. only width and height change
        Alpine.effect(async () => {
            try {
                if (resultContainer.result) {
                    const finalChartProps = {...chartProps, width: this._width};
                    const chart = await charts[chartType](resultContainer.result, finalChartProps);
                    this.$el.innerHTML = '';
                    this.$el.appendChild(chart);
                }
            } catch (e) {
                this.$el.innerHTML = `<b>ERROR: ${e.message}</b>`;
                throw e
            }
        })
    },

    handleResize(width: number, height: number) {
        this._width = width;
        this.$el.style.height = `100%`;
    }
}))