import * as Plot from "@observablehq/plot";
import type {QueryResult} from "../types";

interface AlertOverviewProps {
    width?: number;
}

function hoursMinutes(time: Date) {
    return time.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
}

async function _alertOverview(data: QueryResult, props: AlertOverviewProps): Promise<HTMLElement> {
    let domain = undefined;
    if (data.dashicaResolvedTimeRange?.from && data.dashicaResolvedTimeRange?.to) {
        domain = [data.dashicaResolvedTimeRange.from, data.dashicaResolvedTimeRange.to]
    }

    return Plot.plot({
        width: props.width,
        marginLeft: 130,
        color: {
            legend: false,
            domain: ['OK', 'warn', 'error'],
            range: ['#56AF18', '#F8C666', '#DB5757'],
            unknown: '#8E44AD',
        },
        x: {
            axis: "top",
            type: "time",
            clamp: true,
            domain: domain,
            grid: false,
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
                strokeWidth: (d: any) => d["status"] == 'OK' ? 3 : 10,
            }),
            Plot.tip(
                data.toArray().filter((d: any) => d["status"] !== "OK"),
                Plot.pointerY({
                    x1: "start",
                    x2: "end",
                    y: "alert_id_key",
                    stroke: "status",
                    format: {
                        x1: (d: any) => hoursMinutes(d),
                        x2: (d: any) => hoursMinutes(d),
                        y: false,
                    }
                })
            )
        ]
    }) as HTMLElement;
}

export const alertOverview = _alertOverview;
