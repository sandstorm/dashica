
import "./index.css";
import "./tabulator-theme.css";

import Alpine from '@alpinejs/csp'
import intersect from '@alpinejs/intersect'
import resize from '@alpinejs/resize'

import filterButton from './components/filterButton'
import searchBar from './components/searchBar'
import textInput from './components/textInput'
import checkboxGroup from './components/checkboxGroup'
import speedscopeLink from './components/speedscopeLink'
import {timeBar as timeBarChart} from './chart/timeBar'
import {barVertical as barVerticalChart} from './chart/barVertical'
import {barHorizontal as barHorizontalChart} from './chart/barHorizontal'
import {timeHeatmap as timeHeatmapChart} from './chart/timeHeatmap'
import {timeHeatmapOrdinal as timeHeatmapOrdinalChart} from './chart/timeHeatmapOrdinal'
import {stats as statsChart} from './chart/stats'
import {clickhouseFactory} from './legacy/clickhouse'
import "./store"
import "./components/chart";
import "./components/debugDrawer";

import {autoTable} from "./legacyComponents/autoTable";
import * as Inputs from '@observablehq/inputs';

Alpine.plugin(intersect);
Alpine.plugin(resize);

Alpine.data('filterButton', filterButton);
Alpine.data('searchBar', searchBar);
Alpine.data('textInput', textInput);
Alpine.data('checkboxGroup', checkboxGroup);
Alpine.data('speedscopeLink', speedscopeLink);


window.Alpine = Alpine

window.exports = Alpine.reactive({});
window.Inputs = Inputs;


Alpine.data('legacyInlinePlaceholder', (placeholderName) => ({
    init() {
        Alpine.effect(() => {
            console.log("Rendering", placeholderName, "with component", window.exports[placeholderName])
            const domNodeToRender = window.exports[placeholderName];
            if (!domNodeToRender) {
                return console.warn(
                    "Legacy component", placeholderName, "not found. Did you forget to export it?"
                );
            }

            if (domNodeToRender.then) {
                domNodeToRender.then(domNode => {
                    this.$el.innerHTML = "";
                    if (domNode) {
                        this.$el.appendChild(domNode);
                    }
                })
            } else {
                this.$el.innerHTML = "";
                if (domNodeToRender) {
                    this.$el.appendChild(domNodeToRender);
                }

            }
        })
    }
}));

window.LegacyScriptWrapper = function(baseUrl, thisScriptDomNode, innerScript) {

    const displayContainer = document.createElement('div');
    displayContainer.textContent = '';

    thisScriptDomNode.parentNode.insertBefore(displayContainer, thisScriptDomNode.nextSibling);

    // recompute window.exports.[value] if one of the charts change.
    Alpine.effect(function() {
        const filters = Alpine.store('urlState').getCombinedFilter();

        const chart = {
            timeBar: timeBarChart,
            barVertical: barVerticalChart,
            barHorizontal: barHorizontalChart,
            timeHeatmap: timeHeatmapChart,
            timeHeatmapOrdinal: timeHeatmapOrdinalChart,
            stats: statsChart,
        };
        const component = {
            autoTable
        };

        const visibility = () => Promise.resolve(true); // TODO: we disable intersection observing for now

        const clickhouse = clickhouseFactory(baseUrl);

        const viewOptions = [];
        const invalidation = new Promise(() => {});

        let calledDisplayInstances = 0;
        displayContainer.innerHTML = '';

        const display = (domNode) => {
            calledDisplayInstances++;
            displayContainer.appendChild(domNode);
        }

        const view = (result) => {
            // TODO: if Result is DOM node, ATTACH TO OUTER AND SET UP EVENT HDL. RETURN REACTIVE THINGIE
            display(result);

            result.value;
        };

        innerScript({chart, component, view, visibility, clickhouse, filters, viewOptions, invalidation, exports: window.exports});
    })

}