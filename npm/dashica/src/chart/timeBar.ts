import * as Plot from "@observablehq/plot";
import type {ChannelValue, ChannelValueSpec, QueryResult, ViewOptions} from "../types";
import {decorateChart} from "../component/decorateChart.js";
import {SchemaAnalyzer} from "../util/schema.js";
import {_brushMark} from "./timeBrush_.js";
import type {ScaleOptions} from "@observablehq/plot/src/scales";
import type {Markish} from "@observablehq/plot";
import type {TipOptions} from "@observablehq/plot/src/marks/tip";
import type {PointerOptions} from "@observablehq/plot/src/interactions/pointer";
import type {TipPointer} from "@observablehq/plot/src/mark";

interface ChartProps {
    viewOptions?: ViewOptions;
    /** Chart Title **/
    title?: string | Node;

    /** Chart size **/
    height?: number;
    width?: number,
    marginLeft?: number,
    marginRight?: number,
    marginBottom?: number,
    marginTop?: number,


    /**
     * Options for the *color* scale for fill or stroke. The *color* scale
     * defaults to a *linear* scale with the *turbo* scheme for quantitative
     * (numbers) or temporal (dates) data, and an *ordinal* scale with the
     * *observable10* scheme for categorical (strings or booleans) data.
     *
     * Note: a channel bound to the *color* scale typically bypasses the scale if
     * all associated values are valid CSS color strings; you can override the
     * scale associated with a channel by specifying the value as a {value, scale}
     * object.
     */
    color?: ScaleOptions;

    /**
     * The [fill][1]; a constant CSS color string, or a channel typically bound to
     * the *color* scale. If all channel values are valid CSS colors, by default
     * the channel will not be bound to the *color* scale, interpreting the colors
     * literally.
     *
     * [1]: https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute/fill
     */
    fill?: ChannelValueSpec;

    x: ChannelValueSpec,
    xBucketSize: number,
    y: ChannelValueSpec,

    /**
     * The horizontal facet position channel, for mark-level faceting, bound to
     * the *fx* scale.
     */
    fx?: ChannelValue,

    /**
     * The vertical facet position channel, for mark-level faceting, bound to the
     * *fy* scale.
     */
    fy?: ChannelValue,

    /** Whether to generate a tooltip for this mark, and any tip options. */
    tip?: boolean | TipPointer | (TipOptions & PointerOptions & {pointer?: TipPointer});

    /**
     * A list of extra marks to render
     */
    extraMarks: Markish[];
}

async function _bars(data: QueryResult, props: ChartProps) {
    const schema = new SchemaAnalyzer(data);

    const x = schema.requiredColumn(props.x, 'x');
    let xBucketSize = props.xBucketSize;
    if (!xBucketSize) {
        throw new Error('xBucketSize must be specified.')
    }
    let numberOfUniqueXValues = undefined;
    let domain = undefined;
    let yTransform = undefined;
    if (data.dashicaBucketSize != null) {
        // Auto-bucketing is enabled for this chart (by a comment in the SQL query, like '-- BUCKET: toStartOfFifteenMinutes(timestamp)::DateTime64')
        // and the server determined a bucket size.
        xBucketSize = data.dashicaBucketSize;
        // Since loosing control over the bucket size makes reading the y-axis harder (Are those logs/15m or logs/5min ?),
        // we normalize the values on the y-axis to logs/s.
        // This also effects the hover-labels.
        yTransform = (x: number) => x / xBucketSize * 1000;
    }
    if (data.dashicaResolvedTimeRange?.from && data.dashicaResolvedTimeRange?.to) {
        domain = [data.dashicaResolvedTimeRange.from, data.dashicaResolvedTimeRange.to]
        numberOfUniqueXValues = Math.floor((data.dashicaResolvedTimeRange.to - data.dashicaResolvedTimeRange.from) / xBucketSize);
    }

    // @ts-ignore
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
            domain: domain
        },
        y: {
            label: String(props.y) + (yTransform ? ' / s' : ''),
            grid: true,
            axis: true,
            type: props.viewOptions?.includes("VIEW_LOGARITHMIC") ? "symlog" : undefined,
            transform: yTransform,
        },
        color: props.color || {
            legend: true,
        },
        marks: [
            Plot.rectY(data, {
                x1: x,
                // @ts-ignore
                x2: (d: any) => d[x] + xBucketSize,
                y: schema.requiredColumn(props.y, 'y'),
                fx: props.fx,
                fy: props.fy,
                marginRight: 150,
                tip: props.tip !== undefined ? props.tip : true,
                fill: props.fill || '#A8C1D1',
                // HEURISTIC to determine whether to add an inset or not
                insetLeft: numberOfUniqueXValues === undefined || !props.width ? 0 : (numberOfUniqueXValues * 2 < props.width ? 1 : 0), // a bit of padding between the bars. - HEURISTIC
            }),
            _brushMark,
            Plot.ruleY([0]),
            ...(props.extraMarks || []),
        ]
    })
}


export const timeBar = decorateChart(_bars);
