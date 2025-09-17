import * as Plot from "@observablehq/plot";
import {clickhouse} from "../index.js";
import {decorateChart} from "../component/index.js";
import type {QueryResult, ViewOptions} from "../types.js";
import {timeBar} from "../chart/index.js";
import type {QueryOptions} from "../clickhouse.js";
import {html} from "htl";

let alertGroupPattern = '%';

/**
 * Display only alerts matching the pattern
 * @param pattern a sql LIKE expression
 */
export function setAlertGroupPattern(pattern: string) {
    alertGroupPattern = pattern;
}

export async function alertOverview(options: QueryOptions = {}) {
    const alertGroupFilter = `alert_id_group ILIKE '${alertGroupPattern}'`;
    const withAlertGroupFilter = {
        ...options,
        filters: {
            ...options.filters,
            sqlFilter: Boolean(options.filters?.sqlFilter) ?
                `(${options.filters?.sqlFilter}) AND (${alertGroupFilter})` :
                `${alertGroupFilter}`
        }
    };
    const data = await clickhouse.queryAlerts(withAlertGroupFilter);
    const overviewChart = alertOverviewChart(data, {});

    if (data.dashicaDevmode) {
        if (!options.filters?.from && !options.filters?.to) {
            return html`
                <div class="alertDevToolbar">
                    No From + To specified
                </div>

                ${overviewChart}
            `;
        }

        return html`
            <div class="alertDevToolbar">
                <form method="get" action="/api/debug-calculate-alerts">
                    <input type="hidden" name="filters" value="${JSON.stringify(options.filters)}"/>
                    <button>Calculate alerts for current time range</button>
                    <br/>
                    From: ${options.filters?.from}<br/>
                    To: ${options.filters?.to}
                </form>
            </div>

            ${overviewChart}
        `;
    }

    return overviewChart;
}

async function _alertOverviewChart(data: QueryResult): Promise<SVGSVGElement | HTMLElement> {
    let domain = undefined;
    if (data.dashicaResolvedTimeRange?.from && data.dashicaResolvedTimeRange?.to) {
        domain = [data.dashicaResolvedTimeRange.from, data.dashicaResolvedTimeRange.to]
    }

    return Plot.plot({
        marginLeft: 130,
        color: {
            legend: false,
            domain: ['OK', 'warn', 'error'],
            range: ['#56AF18', '#F8C666', '#DB5757'],
            unknown: '#8E44AD',
        },
        // we display the query result from query_alerts.go, so we exactly know the schema
        x: {
            axis: "top",
            type: "time",
            clamp: true,
            domain: domain,
            grid: false,
            //tickFormat: (x) => x < 0 ? `${-x} BC` : `${x} AD`
        },

        y: {
            label: null,
            axis: null,
        },
        marks: [
            Plot.axisY({label: null, tickSize: 0}),
            Plot.ruleY(data, {
                x1: "start",
                x2: "end",
                y: "alert_id_key",
                stroke: "status",
                strokeWidth: d => d["status"] == 'OK' ? 3 : 10,
            }),
            Plot.tip(
                data.toArray().filter(d => d["status"] !== "OK"),
                Plot.pointerY({
                    x1: "start",
                    x2: "end",
                    y: "alert_id_key",
                    stroke: "status",
                    format: {
                        x1: (d) => hoursMinutes(d),
                        x2: (d) => hoursMinutes(d),
                        y: false,
                    }
                })
            )
        ]
    });
}

export const alertOverviewChart = decorateChart(_alertOverviewChart);

function hoursMinutes(time: Date) {
    return time.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false // Use 24-hour format
    });
}

interface AlertDetailsProps {
    filters: any,
    viewOptions: ViewOptions
}

export async function alertDetails({filters, viewOptions}: AlertDetailsProps) {
    const alertGroupFilter = `alert_id_group ILIKE '${alertGroupPattern}'`;
    const withAlertGroupFilter = {
        filters: {
            ...filters,
            sqlFilter: Boolean(filters?.sqlFilter) ?
                `(${filters?.sqlFilter}) AND (${alertGroupFilter})` :
                `${alertGroupFilter}`
        }
    };
    const data = await clickhouse.queryAlerts(withAlertGroupFilter);
    let alertIds = [...new Set(data.toArray().map((d: any) => d.alert_id))] as string[];


    const wrapper = document.createElement('div');

    for (let i = 0; i < alertIds.length; i++) {
        const data = await clickhouse.queryAlertChartDetails(alertIds[i], {filters})
        wrapper.appendChild(timeBar(data, {
            viewOptions,
            title: alertIds[i],
            xBucketSize: 15 * 60 * 1000,
            x: "time",
            y: "value",
            height: 200,
            extraMarks: [
                [
                    data.dashicaAlertIf?.value_gt ?
                        Plot.ruleY([data.dashicaAlertIf?.value_gt], {stroke: "red"})
                        : undefined
                ],
                [
                    data.dashicaAlertIf?.value_lt ?
                        Plot.ruleY([data.dashicaAlertIf?.value_lt], {stroke: "red"})
                        : undefined
                ]
            ]
        }));
    }

    return wrapper;
}
