import * as Plot from "@observablehq/plot";
import {decorateChart} from "../component/decorateChart.js";
import type {ChannelValue, ChannelValueSpec, QueryResult, ViewOptions} from "../types";
import type {ScaleOptions} from "@observablehq/plot/src/scales";

/**
 * BarVertical: Bars go from bottom to top.
 * - x axis (horizontal): the GROUPING/Category axis
 * - y axis (vertical): the VALUE axis
 */
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

async function _vertical(data: QueryResult, props: ChartProps) {
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
            axis: !Boolean(props.fx), // do not show the axis if fx is configured (because this will be the axis instead)
            tickRotate: -30,
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
            Plot.barY(data, {
                x: props.x,
                y: props.y,
                fx: props.fx,
                fy: props.fy,
                tip: true,
                fill: props.fill || (props.fx ? props.x : '#A8C1D1'),
            })
        ]
    });
}

export const barVertical = decorateChart(_vertical);