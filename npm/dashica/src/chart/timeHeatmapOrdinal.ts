import * as Plot from "@observablehq/plot";
import type {ChannelValueSpec, QueryResult, ViewOptions} from "../types";
import {decorateChart} from "../component/decorateChart.js";
import {SchemaAnalyzer} from "../util/schema.js";
import {_brushMark} from "./timeBrush_.js";

interface ChartProps {
    viewOptions?: ViewOptions;
    /** Chart Title **/
    title?: string | Node;

    /** Chart size **/
    height?: number;
    width?: number,
    marginLeft?: number,

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
    yBucketSize: number,
}


async function _heatmapOrdinal(data: QueryResult, props: ChartProps) {
    const schema = new SchemaAnalyzer(data);

    const x = schema.requiredColumn(props.x, 'x');
    if (!props.xBucketSize) {
        throw new Error('xBucketSize must be specified.')
    }

    const y = schema.requiredColumn(props.y, 'y');

    // @ts-ignore
    return Plot.plot({
        title: props.title,
        height: props.height,
        width: props.width,
        marginLeft: props.marginLeft,
        x: {
            label: String(props.x),
            grid: false,
            axis: true,
            type: "utc",
        },
        y: {
            label: String(props.y),
            grid: false,
            axis: true,
        },
        color: {
            scheme: 'blues',
            legend: true,
        },
        marks: [
            Plot.barX(data, {
                x: x,
                // @ts-ignore
                x2: (d: any) => d[x] + props.xBucketSize,

                y: y,
                tip: true,
                fill: props.fill,
            }),
            _brushMark,
            Plot.ruleY([0])
        ]
    })
}
export const timeHeatmapOrdinal = decorateChart(_heatmapOrdinal)
