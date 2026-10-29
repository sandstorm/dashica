// UNMIGRATED (workbench): port, rewrite or delete, then remove this line. See docs/2026-10-28-workbench.md §5.
import * as Plot from "@observablehq/plot";
import type {ChannelValueSpec, QueryResult, ViewOptions} from "../types";
//import {decorateChart} from "../component/decorateChart.js";
import {SchemaAnalyzer} from "../extensions/chart-library/schema";
import {timeBrush} from "../extensions/chart-library/time-brush";

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
    // the time range the viewer drags across the chart
    onTimeSelect: (from: Date, to: Date) => void,
    y: ChannelValueSpec,
    yBucketSize: number,

    // filled from components/chart.ts
    colorSchemeDark: boolean,
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
            scheme: props.colorSchemeDark ? 'inferno' : 'blues',
            legend: true,
        },
        marks: [
            Plot.barX(data, {
                x: x,
                // @ts-ignore
                x2: (d: any) => d[x] + props.xBucketSize,

                y: y,
                // Clip to the frame: the last bucket's x2 extends one bucket past
                // the auto-fit domain and would otherwise paint outside the SVG.
                clip: true,
                tip: true,
                fill: props.fill,
            }),
            timeBrush(props.onTimeSelect),
            Plot.ruleY([0])
        ]
    })
}
//export const timeHeatmapOrdinal = decorateChart(_heatmapOrdinal)
export const timeHeatmapOrdinal = _heatmapOrdinal
