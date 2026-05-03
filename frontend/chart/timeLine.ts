import * as Plot from "@observablehq/plot";
import type {ChannelValueSpec, QueryResult, ViewOptions} from "../types";
import {_brushMark} from "./timeBrush_.js";

interface ChartProps {
    viewOptions?: ViewOptions;
    title?: string | Node;
    height?: number;
    width?: number;
    marginLeft?: number;
    marginRight?: number;
    marginBottom?: number;
    marginTop?: number;

    x: ChannelValueSpec;
    xBucketSize: number;
    y: ChannelValueSpec;

    /** CSS color string for the line stroke */
    stroke?: string;
}

export function timeLine(data: QueryResult, props: ChartProps) {
    let xBucketSize = props.xBucketSize;
    let domain = undefined;

    if (data.dashicaBucketSize != null) {
        xBucketSize = data.dashicaBucketSize;
    }

    if (data.dashicaResolvedTimeRange?.from && data.dashicaResolvedTimeRange?.to) {
        domain = [data.dashicaResolvedTimeRange.from, data.dashicaResolvedTimeRange.to];
    }

    return Plot.plot({
        title: props.title,
        height: props.height,
        width: props.width,
        marginLeft: props.marginLeft,
        marginRight: props.marginRight,
        marginBottom: props.marginBottom,
        marginTop: props.marginTop,
        x: {
            label: String(props.x),
            grid: false,
            axis: true,
            type: "time",
            domain: domain,
        },
        y: {
            label: String(props.y),
            grid: true,
            axis: true,
            type: props.viewOptions?.includes("VIEW_LOGARITHMIC") ? "symlog" : undefined,
        },
        marks: [
            Plot.lineY(data, {
                x: props.x,
                y: props.y,
                stroke: props.stroke || '#4682B4',
                tip: true,
            }),
            Plot.dotY(data, {
                x: props.x,
                y: props.y,
                fill: props.stroke || '#4682B4',
                r: 2,
            }),
            _brushMark,
            Plot.ruleY([0]),
        ].filter(Boolean),
    });
}
