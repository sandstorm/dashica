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
        console.log("Chart loading", this.$el.dataset.chartType, this.$el.dataset.chartProps);
        console.log("Chart loading", this.$el.dataset.chartType, this.$el.dataset.chartProps);
        const chartType = this.$el.dataset.chartType;
        const widgetBaseUrl = this.$el.dataset.widgetBaseUrl;
        const chartProps = JSON.parse(this.$el.dataset.chartProps);

        Alpine.effect(async () => {
            try {
                const result = await query(widgetBaseUrl + "/query", this.$store.urlState.getCombinedFilter())
                const chart = await charts[chartType](result, chartProps);
                console.log("Chart loaded", chartType, chartProps, chart);
                this.$el.appendChild(chart);
            } catch (e) {
                this.$el.innerHTML = `<b>ERROR: ${e.message}</b>`;
                throw e
            }

        })
    }
}))