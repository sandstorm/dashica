import * as Plot from '@observablehq/plot';
import type { SqlFieldProps } from '../../generated/zz_generated.dashica';
import type { QueryResult, WidgetContext } from '../../hosts/widgets/widgets';
import { columnTypesOf, dataPointOf } from './data-point';
import './filter-on-click.css';

/**
 * A Plot mark with which a click shows the data point menu of the row the chart's tip shows (where the `filters`
 * extension offers to filter by it): `mark` (the chart's mark function, `Plot.barY`) with the chart mark's `options`
 * (its tip left out) under the pointer transform the tip uses (`pointer`, the chart mark's `tip` pointer), so it points
 * at the same row as the tip, stacking included. A click while it points at a row shows `ctx`'s data point menu for
 * the row's categories: one data point per field of `fields` that is a category with a value, in order, each by its
 * alias (`dataPointOf`, with the column's type the answer names, `columnTypesOf`). Its element is an empty `g`, with
 * `d-filter-on-click--pointing` while it points at a row (the pointer cursor). `null` without a category among
 * `fields`. Every Plot chart type puts one after its mark.
 */
export function filterOnClick<O extends Plot.MarkOptions>(
  mark: (data: QueryResult, options: Omit<O & FilterOnClickOptions, keyof FilterOnClickOptions>) => Plot.Markish,
  data: QueryResult,
  { fields, ctx, pointer, ...options }: O & FilterOnClickOptions,
): Plot.Markish {
  const categories = fields.filter((field, at): field is SqlFieldProps => {
    return field !== undefined && isCategory(field) && fields.findIndex((other) => other?.alias === field.alias) === at;
  });
  if (categories.length === 0) return null;
  const types = columnTypesOf(data);
  // the row each rendered element points at; the pointer replaces the element whenever it points elsewhere. A faceted
  // chart has one element per facet, and Plot's pointer empties the losing facets' elements only an animation frame later
  // (pointer.js), so the row clicked is the one of the element that points, asked of the DOM
  const rows = new WeakMap<Element, Record<string, unknown>>();
  const listening = new WeakSet<SVGSVGElement>();
  const pointedRow = (svgElement: SVGSVGElement) => [...svgElement.querySelectorAll('.d-filter-on-click--pointing')].map((pointingElement) => rows.get(pointingElement)).find(Boolean);

  const listen = (svgElement: SVGSVGElement) => {
    // Plot's pointer pins the tip on a mouse's pointerdown while it points at a row, and then stops following the
    // mouse until the next pointerdown unpins it, so a second click would show nothing (Plot's source only,
    // pointer.js: `pointerdown`, `state.sticky`; its typings say nothing of it). A mouse's pointerdown therefore stops
    // at the svg, before Plot's listeners on it; Plot stops the same pointerdowns itself (stopImmediatePropagation),
    // so nothing past the svg misses them. Plot pins on no touch or pen, which pass.
    svgElement.addEventListener('pointerdown', (event) => event.pointerType === 'mouse' && pointedRow(svgElement) && event.stopPropagation(), true);
    // the svg, where Plot's pointer listens too (its source, pointer.js): a click on what lies above the marks (a time
    // chart's drag area) counts as one on them
    svgElement.addEventListener('click', (event) => {
      const row = pointedRow(svgElement);
      if (!row) return;
      const dataPoints = categories.flatMap((field) => {
        const value = row[field.alias];
        return value == null ? [] : [dataPointOf(field.alias, value, types)];
      });
      if (dataPoints.length > 0) ctx.showDataPointMenu({ x: event.clientX, y: event.clientY }, dataPoints);
    });
  };

  // Plot's pointer calls it with the index of the row it points at, or an empty one
  const render: Plot.RenderFunction = (index, _scales, _values, _dimensions, context) => {
    const svgElement = context.ownerSVGElement;
    if (!listening.has(svgElement)) {
      listening.add(svgElement);
      listen(svgElement);
    }
    const layerElement = context.document.createElementNS('http://www.w3.org/2000/svg', 'g');
    layerElement.setAttribute('class', 'd-filter-on-click');
    layerElement.setAttribute('aria-hidden', 'true');
    // the index counts the rows of `data`, which Plot's pointer reads the same way (pointer.js: `data.get(i)`)
    const row = index.length > 0 ? (data.get(index[0]) as Record<string, unknown> | null) : null;
    if (row) {
      rows.set(layerElement, row);
      layerElement.classList.add('d-filter-on-click--pointing');
    }
    return layerElement;
  };
  return mark(data, POINTERS[pointer]({ ...options, render }));
}

export interface FilterOnClickOptions {
  /** The fields whose categories a click shows, each a channel's field as the chart maps it, in order. */
  readonly fields: readonly (SqlFieldProps | undefined)[];
  /** The chart's widget context, whose data point menu a click shows. */
  readonly ctx: Pick<WidgetContext, 'showDataPointMenu'>;
  /**
   * The pointer of the chart mark's tip, which the chart names in its `tip` option: Plot points a tip with `"x"`
   * (`Plot.pointerX`, mostly by x), `"y"` or `"xy"` (`Plot.pointer`, the closest point), and without one it picks it
   * per mark: `"x"` for a stacked `barY` or `rectY`, `"y"` for `barX` or `rectX`, else `"xy"` (Plot's source only,
   * transforms/stack.js: `withTip(options, "x")` in `maybeStackY`). A pointer of another kind points at another row
   * than the tip (by x, the bar under the mouse; by distance, a bar of the next bucket closer to it).
   */
  readonly pointer: Plot.TipPointer;
}

/** Plot's pointer transform for each tip pointer. */
const POINTERS = { x: Plot.pointerX, y: Plot.pointerY, xy: Plot.pointer } as const;

/** Whether `field` holds categories: not a measure (`count`), not a time bucket (`autoBucket`, a bucket size). */
function isCategory(field: SqlFieldProps): boolean {
  return field.kind !== 'count' && field.kind !== 'autoBucket' && !field.xBucketSizeMs;
}
