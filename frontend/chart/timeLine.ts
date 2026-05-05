import * as Plot from "@observablehq/plot";
import type {ChannelValue, ChannelValueSpec, QueryResult, ViewOptions} from "../types";
import {SchemaAnalyzer} from "../util/schema";
import {_brushMark} from "./timeBrush_.js";
import type {ScaleOptions} from "@observablehq/plot/src/scales";
import type {Markish} from "@observablehq/plot";
import type {TipOptions} from "@observablehq/plot/src/marks/tip";
import type {PointerOptions} from "@observablehq/plot/src/interactions/pointer";
import type {TipPointer} from "@observablehq/plot/src/mark";

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

    color?: ScaleOptions;
    stroke?: ChannelValueSpec;
    fx?: ChannelValue;
    fy?: ChannelValue;
    tip?: boolean | TipPointer | (TipOptions & PointerOptions & {pointer?: TipPointer});
    extraMarks?: Markish[];
}

export function timeLine(data: QueryResult, props: ChartProps) {
    const schema = new SchemaAnalyzer(data);

    const x = schema.requiredColumn(props.x, 'x');
    const y = schema.requiredColumn(props.y, 'y');
    let xBucketSize = props.xBucketSize;
    let domain = undefined;

    if (data.dashicaBucketSize != null) {
        xBucketSize = data.dashicaBucketSize;
        // Unlike timeBar, line charts are not normalized to /s. They are commonly
        // used for already-normalized rates or ratios.
    }

    if (!xBucketSize) {
        throw new Error('xBucketSize must be specified, or auto-bucketing must be activated via -- BUCKET: ... in the SQL query.')
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
        color: props.color || {
            legend: true,
        },
        marks: [
            Plot.line(data, {
                x: x,
                y: y,
                fx: props.fx,
                fy: props.fy,
                marginRight: 150,
                stroke: props.stroke || '#4682B4',
                tip: props.tip !== undefined ? props.tip : true,
            }),
            _brushMark,
            Plot.ruleY([0]),
            ...(props.extraMarks || []),
        ].filter(Boolean),
    });
}
