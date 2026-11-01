import type { RenderFunction } from '@observablehq/plot';
import { pointer } from 'd3-selection';
import type { TimeCursor } from '../../hosts/widgets/widgets';
import './time-cursor.css';

/**
 * A mark that draws the time cursor all time charts share (`TimeCursor`) as a line across a time chart, hidden while
 * it is outside the chart's time range, and sets it to the time under the pointer while that is in the chart's frame,
 * to none once it leaves the chart. So each time chart shows the time the viewer points at in another. Every time
 * chart puts one before its `timeBrush`, under which the pointer moves.
 */
export function timeCursor(cursor: TimeCursor): RenderFunction {
  return (_index, scales, _channels, dimensions, context) => {
    const x = scales.scales.x;
    if (!x?.invert) return null;
    const [left, right] = (x.range as [number, number]).toSorted((a, b) => a - b);
    const [top, bottom] = scales.scales.y?.range
      ? (scales.scales.y.range as [number, number]).toSorted((a, b) => a - b)
      : [dimensions.marginTop, dimensions.height - dimensions.marginBottom];
    const lineElement = context.document.createElementNS('http://www.w3.org/2000/svg', 'line');
    lineElement.setAttribute('class', 'd-time-cursor');
    lineElement.setAttribute('y1', String(top));
    lineElement.setAttribute('y2', String(bottom));

    const drawLine = () => {
      const at = cursor.time === undefined ? undefined : x.apply(new Date(cursor.time));
      const inside = at !== undefined && at >= left && at <= right;
      lineElement.setAttribute('visibility', inside ? 'visible' : 'hidden');
      if (inside) {
        lineElement.setAttribute('x1', String(at));
        lineElement.setAttribute('x2', String(at));
      }
    };
    drawLine();
    cursor.onDidChange(drawLine);

    // a faceted chart has a line per facet, each in its facet's coordinates: the one whose facet holds the pointer sets
    const svgElement = context.ownerSVGElement;
    svgElement.addEventListener('pointermove', (event) => {
      const [px, py] = pointer(event, lineElement);
      if (px >= left && px <= right && py >= top && py <= bottom) cursor.set((x.invert!(px) as Date).getTime());
    });
    svgElement.addEventListener('pointerleave', () => cursor.set(undefined));
    return lineElement;
  };
}
