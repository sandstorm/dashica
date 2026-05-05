import Alpine from '@alpinejs/csp';

import {timeBar} from '../chart/timeBar'
import {timeLine} from '../chart/timeLine'
import {barVertical} from '../chart/barVertical'
import {barHorizontal} from '../chart/barHorizontal'
import {timeHeatmap} from '../chart/timeHeatmap'
import {timeHeatmapOrdinal} from '../chart/timeHeatmapOrdinal'
import {stats} from '../chart/stats'
import {table} from '../chart/table'
import {alertOverview} from '../chart/alertOverview'
import {query} from "./util/clickhouse-new";

const charts = {
    timeBar,
    timeLine,
    barVertical,
    barHorizontal,
    timeHeatmap,
    timeHeatmapOrdinal,
    stats,
    table,
    alertOverview,
}

Alpine.data('chart', () => ({

    _visible: false,
    _queryResult: null,
    _debugInfo: null,
    _colorSchemeDark: false,
    _width: 0,
    _widgetBaseUrl: '',
    _chartType: '',
    _isLoading: false,

    init() {

        const chartType = this.$el.dataset.chartType;
        const widgetBaseUrl = this.$el.dataset.widgetBaseUrl;
        const chartProps = JSON.parse(this.$el.dataset.chartProps);

        // Store for later use
        this._widgetBaseUrl = widgetBaseUrl;
        this._chartType = chartType;

        this._colorSchemeDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', event => {
            this._colorSchemeDark = event.matches ? "dark" : "light";
        });

        Alpine.effect(async () => {
            if (!this._visible) return;
            this._isLoading = true;
            try {
                this._queryResult = await query(widgetBaseUrl + "/query", this.$store.urlState.getCombinedFilter(), this.$store.urlState.widgetParams)
            } catch (e) {
                this.$refs.chartContainer.innerHTML = `<b>ERROR: ${e.message} (chart type: ${chartType})</b>`;
                throw e
            } finally {
                this._isLoading = false;
            }
        });
        // we use a separate Alpine.effect here, to not reload the result if e.g. only width and height change
        Alpine.effect(async () => {
            try {
                if (this._queryResult) {
                    const viewOptions = this.$store.urlState.logScale ? ['VIEW_LOGARITHMIC'] : [];
                    const finalChartProps = {...chartProps, width: this._width, colorSchemeDark: this._colorSchemeDark, viewOptions};
                    const chart = await charts[chartType](this._queryResult, finalChartProps);
                    this.$refs.chartContainer.innerHTML = '';
                    this.$refs.chartContainer.appendChild(chart);
                }
            } catch (e) {
                this.$refs.chartContainer.innerHTML = `<b>ERROR: ${e.message} (chart type: ${chartType})</b>`;
                throw e
            }
        })
    },

    handleEnteredViewport() {
        this._visible = true;
    },

    async toggleDebug() {
        try {
            const response = await fetch(this._widgetBaseUrl + "/debug?" + new URLSearchParams({
                filters: JSON.stringify(this.$store.urlState.getCombinedFilter())
            }));
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            this._debugInfo = await response.json();
        } catch (e) {
            console.error("Failed to fetch debug info:", e);
            this._debugInfo = {error: e.message};
        }
        this.$dispatch('dashica-debugDrawer-toggle', {
            queryResult: this._queryResult,
            debugInfo: this._debugInfo
        })
    },

    handleResize(width: number, height: number) {
        this._width = width;
    }
}))