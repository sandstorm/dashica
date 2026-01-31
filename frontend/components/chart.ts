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

    _visible: false,
    _queryResult: null,
    _colorSchemeDark: false,
    _width: 0,

    init() {

        const chartType = this.$el.dataset.chartType;
        const widgetBaseUrl = this.$el.dataset.widgetBaseUrl;
        const chartProps = JSON.parse(this.$el.dataset.chartProps);

        this._colorSchemeDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', event => {
            this._colorSchemeDark = event.matches ? "dark" : "light";
        });

        Alpine.effect(async () => {
            if (!this._visible) return;
            try {
                this._queryResult = await query(widgetBaseUrl + "/query", this.$store.urlState.getCombinedFilter())
            } catch (e) {
                this.$refs.chartContainer.innerHTML = `<b>ERROR: ${e.message}</b>`;
                throw e
            }
        });
        // we use a separate Alpine.effect here, to not reload the result if e.g. only width and height change
        Alpine.effect(async () => {
            try {
                if (this._queryResult) {
                    const finalChartProps = {...chartProps, width: this._width, colorSchemeDark: this._colorSchemeDark};
                    const chart = await charts[chartType](this._queryResult, finalChartProps);
                    this.$refs.chartContainer.innerHTML = '';
                    this.$refs.chartContainer.appendChild(chart);
                }
            } catch (e) {
                this.$refs.chartContainer.innerHTML = `<b>ERROR: ${e.message}</b>`;
                throw e
            }
        })
    },

    handleEnteredViewport() {
        this._visible = true;
    },

    toggleDebug() {
        this.$dispatch('dashica-debugDrawer-toggle', {queryResult: this._queryResult})
    },

    handleResize(width: number, height: number) {
        this._width = width;
        this.$el.style.height = `100%`;
    }
}))