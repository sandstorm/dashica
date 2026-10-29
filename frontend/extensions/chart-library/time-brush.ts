import type { RenderFunction } from '@observablehq/plot';
import { brushX, type D3BrushEvent } from 'd3-brush';
import { create } from 'd3-selection';

/**
 * A mark that lets the viewer drag across a time chart to select a time range: `onSelect` gets its start and end when
 * the drag ends. After https://github.com/observablehq/plot/issues/5#issuecomment-2094321721.
 */
export function timeBrush(onSelect: (from: Date, to: Date) => void): RenderFunction {
  return (_index, scales, _channels, dimensions) => {
    const brushed = (event: D3BrushEvent<undefined>) => {
      const x = scales.scales.x;
      if (event.type !== 'end' || !Array.isArray(event.selection) || !x?.invert) return;
      const [from, to] = event.selection as [number, number];
      onSelect(x.invert(from), x.invert(to));
    };
    const brush = brushX<undefined>()
      .extent([
        [dimensions.marginLeft, 0],
        [dimensions.width - dimensions.marginRight, dimensions.height],
      ])
      .on('end', brushed);
    return create<SVGGElement>('svg:g').call(brush).node()!;
  };
}
