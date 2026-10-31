import * as Plot from '@observablehq/plot';
import type { SqlFieldProps } from '../../generated/zz_generated.dashica';
import type { QueryResult, WidgetContext } from '../../hosts/widgets/widgets';
import './filter-on-click.css';

/**
 * A Plot mark with which a click offers to filter by a category of the row the chart's tip shows: `mark` (the chart's
 * mark function, `Plot.barY`) with the chart mark's `options` (its tip left out) under Plot's pointer transform, so it
 * points at the same row as the tip, stacking included. A click while it points at a row hands `offerFilters` the row's
 * categories as candidates: one per field of `fields` that is a category with a value, in order, each by its alias. Its
 * element is an empty `g`, with `d-filter-on-click--pointing` while it points at a row (the pointer cursor).
 * `null` without a category among `fields`. Every Plot chart type puts one after its mark.
 */
export function filterOnClick<O extends Plot.MarkOptions>(
  mark: (data: QueryResult, options: Omit<O & FilterOnClickOptions, keyof FilterOnClickOptions>) => Plot.Markish,
  data: QueryResult,
  { fields, offerFilters, ...options }: O & FilterOnClickOptions,
): Plot.Markish {
  const categories = fields.filter((field, at): field is SqlFieldProps => {
    return field !== undefined && isCategory(field) && fields.findIndex((other) => other?.alias === field.alias) === at;
  });
  if (categories.length === 0) return null;
  // the row each rendered element points at; the pointer replaces the element whenever it points elsewhere. A faceted
  // chart has one element per facet, and Plot's pointer empties the losing facets' elements only an animation frame later
  // (pointer.js), so the row clicked is the one of the element that points, asked of the DOM
  const rows = new WeakMap<Element, Record<string, unknown>>();
  const listening = new WeakSet<SVGSVGElement>();
  const pointedRow = (svg: SVGSVGElement) => [...svg.querySelectorAll('.d-filter-on-click--pointing')].map((g) => rows.get(g)).find(Boolean);

  const listen = (svg: SVGSVGElement) => {
    // Plot's pointer pins the tip on a mouse's pointerdown while it points at a row, and then stops following the
    // mouse until the next pointerdown unpins it, so a second click would offer nothing (Plot's source only,
    // pointer.js: `pointerdown`, `state.sticky`; its typings say nothing of it). A mouse's pointerdown therefore stops
    // at the svg, before Plot's listeners on it; Plot stops the same pointerdowns itself (stopImmediatePropagation),
    // so nothing past the svg misses them. Plot pins on no touch or pen, which pass.
    svg.addEventListener('pointerdown', (event) => event.pointerType === 'mouse' && pointedRow(svg) && event.stopPropagation(), true);
    // the svg, where Plot's pointer listens too (its source, pointer.js): a click on what lies above the marks (a time
    // chart's drag area) counts as one on them
    svg.addEventListener('click', (event) => {
      const row = pointedRow(svg);
      if (!row) return;
      const candidates = categories.flatMap((field) => {
        const value = row[field.alias];
        return value == null ? [] : [{ fieldId: field.alias, value: String(value) }];
      });
      if (candidates.length > 0) offerFilters({ x: event.clientX, y: event.clientY }, candidates);
    });
  };

  // Plot's pointer calls it with the index of the row it points at, or an empty one
  const render: Plot.RenderFunction = (index, _scales, _values, _dimensions, context) => {
    const svg = context.ownerSVGElement;
    if (!listening.has(svg)) {
      listening.add(svg);
      listen(svg);
    }
    const g = context.document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'd-filter-on-click');
    g.setAttribute('aria-hidden', 'true');
    // the index counts the rows of `data`, which Plot's pointer reads the same way (pointer.js: `data.get(i)`)
    const row = index.length > 0 ? (data.get(index[0]) as Record<string, unknown> | null) : null;
    if (row) {
      rows.set(g, row);
      g.classList.add('d-filter-on-click--pointing');
    }
    return g;
  };
  // Plot.pointer, as Plot points a mark's tip (`tip: true`, `tip: {channels}`: its "xy" pointer)
  return mark(data, Plot.pointer({ ...options, render }));
}

export interface FilterOnClickOptions {
  /** The fields whose categories a click offers, each a channel's field as the chart maps it, in order. */
  readonly fields: readonly (SqlFieldProps | undefined)[];
  readonly offerFilters: WidgetContext['offerFilters'];
}

/** Whether `field` holds categories: not a measure (`count`), not a time bucket (`autoBucket`, a bucket size). */
function isCategory(field: SqlFieldProps): boolean {
  return field.kind !== 'count' && field.kind !== 'autoBucket' && !field.xBucketSizeMs;
}
