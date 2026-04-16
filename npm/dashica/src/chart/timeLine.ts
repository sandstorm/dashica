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
     * The [stroke][1]; a constant CSS color string, or a channel typically bound
     * to the *color* scale. If all channel values are valid CSS colors, by
     * default the channel will not be bound to the *color* scale, interpreting
     * the colors literally. When bound to a categorical channel, the line will
     * be grouped into one line per distinct value (the *z* channel of
     * Plot.line).
     *
     * [1]: https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute/stroke
     */
    stroke?: ChannelValueSpec;

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

async function _line(data: QueryResult, props: ChartProps) {
    const schema = new SchemaAnalyzer(data);

    const x = schema.requiredColumn(props.x, 'x');
    const y = schema.requiredColumn(props.y, 'y');
    let xBucketSize = props.xBucketSize;

    let domain = undefined;
    if (data.dashicaBucketSize != null) {
        // Auto-bucketing is enabled for this chart (by a comment in the SQL query, like '-- BUCKET: toStartOfFifteenMinutes(timestamp)::DateTime64')
        // and the server determined a bucket size.
        xBucketSize = data.dashicaBucketSize;
        // NOTE: Unlike timeBar, we do NOT normalize y values to /s here.
        // Line charts are typically used for rate/ratio metrics (e.g. percentages)
        // where the value is already normalized and should not be divided by time.
    }

    if (!xBucketSize) {
        throw new Error('xBucketSize must be specified, or auto-bucketing must be activated via -- BUCKET: ... in the SQL query.')
    }

    if (data.dashicaResolvedTimeRange?.from && data.dashicaResolvedTimeRange?.to) {
        domain = [data.dashicaResolvedTimeRange.from, data.dashicaResolvedTimeRange.to]
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
                tip: props.tip !== undefined ? props.tip : true,
                stroke: props.stroke || '#A8C1D1',
            }),
            _brushMark,
            Plot.ruleY([0]),
            ...(props.extraMarks || []),
        ]
    })
}


export const timeLine = decorateChart(_line);
