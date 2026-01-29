
// BRUSHING:
// Brushing taken from https://github.com/observablehq/plot/issues/5#issuecomment-2094321721, and minimally adjusted.
import type {RenderFunction} from "@observablehq/plot";
import {brushX} from "d3-brush";
import {create} from "d3-selection";

export const _brushMark: RenderFunction = (index, scales, channels, dimensions, context) => {
    const x1 = dimensions.marginLeft;
    const x2 = dimensions.width - dimensions.marginRight;
    const y1 = 0;
    const y2 = dimensions.height;
    const brushed = (event: any) => {
        if (event.type === 'end') {
            // @ts-ignore
            const times = event.selection?.map(scales.x.invert);
            const from: Date = times[0];
            const to: Date = times[1];
            window.dispatchEvent(new CustomEvent('dashica-set-time', {detail: {from, to}}));
        }
    };
    const brush = brushX().extent([[x1, y1], [x2, y2]]).on("brush end", brushed);
    // @ts-ignore
    return create("svg:g").call(brush).node() as SVGGElement;
};
