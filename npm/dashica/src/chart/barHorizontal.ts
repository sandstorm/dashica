import * as Plot from "@observablehq/plot";
import {decorateChart} from "../component/decorateChart.js";
import type {ChannelValue, ChannelValueSpec, QueryResult, ViewOptions} from "../types";
import type {ScaleOptions} from "@observablehq/plot/src/scales";

/**
 * BarHorizontal: Bars go from left to right.
 * - x axis (horizontal): the VALUE axis
 * - y axis (vertical): the GROUPING/Category axis
 */
interface ChartProps {
    viewOptions?: ViewOptions;
    /** Chart Title **/
    title?: string | Node;

    /** Chart size **/
    height?: number;
    width?: number,
    marginLeft?: number,

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
}

async function _horizontal(data: QueryResult, props: ChartProps) {
    return Plot.plot({
        title: props.title,
        height: props.height,
        width: props.width,
        marginLeft: props.marginLeft,
        x: {
            label: String(props.x),
            grid: true,
            axis: true,
        },
        y: {
            label: String(props.y),
            grid: false,
            axis: !Boolean(props.fy), // do not show the axis if fx is configured (because this will be the axis instead)
            type: props.viewOptions?.includes("VIEW_LOGARITHMIC") ? "symlog" : undefined,
        },
        color: props.color || {
            legend: true,
        },
        marks: [
            Plot.barX(data, {
                x: props.x,
                y: props.y,
                fx: props.fx,
                fy: props.fy,
                tip: true,
                fill: props.fill || (props.fy ? props.y : '#A8C1D1'),
            })
        ]
    });
}

export const barHorizontal = decorateChart(_horizontal);