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
import {query, queryPost} from "./util/clickhouse-new";
import {getCombinedFilter, resolveScope} from "../store";

// Exported so the Explore preview (frontend/explore) can render a widget from a
// POST'd JSON envelope through the exact same renderers as compiled dashboards.
export const charts = {
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
    _initialLoad: true,
    // Explore preview mode: when set, the widget is not a compiled endpoint but
    // a JSON envelope. Data is fetched by POSTing _previewBody to
    // <_previewBase>/query instead of GETting <widgetBaseUrl>/query. Everything
    // else (chartProps, rendering, debug) is identical — so the preview reuses
    // this component unchanged, per docs §4.4.
    _previewBase: '',
    _previewBody: '',

    init() {

        const chartType = this.$el.dataset.chartType;
        const widgetBaseUrl = this.$el.dataset.widgetBaseUrl;
        const chartProps = JSON.parse(this.$el.dataset.chartProps);

        // Store for later use
        this._widgetBaseUrl = widgetBaseUrl;
        this._chartType = chartType;
        this._previewBase = this.$el.dataset.previewBase || '';
        this._previewBody = this.$el.dataset.previewBody || '';

        // Render the title immediately as a placeholder so loading dashboards
        // are not a wall of anonymous boxes. Observable Plot renders its own
        // <h2> title; the innerHTML='' below (when the chart is appended)
        // replaces this placeholder seamlessly.
        if (typeof chartProps.title === 'string' && chartProps.title.length > 0) {
            const placeholder = document.createElement('h2');
            placeholder.textContent = chartProps.title;
            placeholder.style.font = 'bold 11pt sans-serif';
            placeholder.style.margin = '0 0 0.5em 0';
            placeholder.style.position = 'absolute';
            placeholder.style.top = '0';
            placeholder.style.left = '0';
            this.$refs.chartContainer.appendChild(placeholder);
        }

        this._colorSchemeDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', event => {
            this._colorSchemeDark = event.matches ? "dark" : "light";
        });

        Alpine.effect(async () => {
            if (!this._visible) return;
            this._isLoading = true;
            try {
                const filter = getCombinedFilter(this.$el);
                const wp = resolveScope(this.$el)?.widgetParams ?? {};
                this._queryResult = this._previewBase
                    ? await queryPost(this._previewBase + "/query", this._previewBody, filter, wp)
                    : await query(widgetBaseUrl + "/query", filter, wp)
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
                    const viewOptions = this.$store.timeState.logScale ? ['VIEW_LOGARITHMIC'] : [];
                    const finalChartProps = {...chartProps, width: this._width, colorSchemeDark: this._colorSchemeDark, viewOptions};
                    const chart = await charts[chartType](this._queryResult, finalChartProps);
                    this.$refs.chartContainer.innerHTML = '';
                    this.$refs.chartContainer.appendChild(chart);
                    this._initialLoad = false;
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
            const qs = "?" + new URLSearchParams({
                filters: JSON.stringify(getCombinedFilter(this.$el))
            });
            const response = this._previewBase
                ? await fetch(this._previewBase + "/debug" + qs, {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: this._previewBody,
                })
                : await fetch(this._widgetBaseUrl + "/debug" + qs);
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
