import * as Plot from '@observablehq/plot';
import type { SqlFieldProps } from '../../generated/zz_generated.dashica';
import type { Commands } from '../../hosts/commands/commands';
import type { MenuAnchor } from '../../hosts/ui/ui';
import type { FilterCandidate, PillSource, QueryResult } from '../../hosts/widgets/widgets';
import { candidateOf } from './candidate';
import './filter-on-click.css';

/**
 * A Plot mark with which a click offers to filter by a category of the row the chart's tip shows: `mark` (the chart's
 * mark function, `Plot.barY`) with the chart mark's `options` (its tip left out) under Plot's pointer transform, so it
 * points at the same row as the tip, stacking included. A click while it points at a row hands `offerFilters` the row's
 * categories as candidates: one per field of `fields` that is a category with a value, in order, each by its alias
 * (`candidateOf`, with the column's type the answer names). Its
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
        return value == null ? [] : [candidateOf(field.alias, value, data.dashicaColumnTypes)];
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
  readonly offerFilters: OfferFilters;
}

/** Offers to filter by or exclude each of `candidates` at `at` (a click's point, a cell). */
export type OfferFilters = (at: MenuAnchor, candidates: readonly FilterCandidate[]) => void;

/** The command a click runs with its point, its candidates and the widget's pills (the `filters` extension's). */
const OFFER = 'filters.offer';

/**
 * How a click on `widget`'s marks, cells or rows offers its candidates: it runs the command `filters.offer` with them
 * and the widget's `dataUrl` and `filterable` (whose `/pill` makes the pill, which fields make one). The `filters`
 * extension shows the quick pick; without it a click offers nothing (the unknown command goes to the console).
 */
export function offerFiltersOf(commands: Pick<Commands, 'executeCommand'>, { dataUrl, filterable }: PillSource): OfferFilters {
  return (at, candidates) => {
    commands.executeCommand(OFFER, at, candidates, { dataUrl, filterable }).catch((error: unknown) => console.error(`Command ${OFFER} failed:`, error));
  };
}

/** Whether `field` holds categories: not a measure (`count`), not a time bucket (`autoBucket`, a bucket size). */
function isCategory(field: SqlFieldProps): boolean {
  return field.kind !== 'count' && field.kind !== 'autoBucket' && !field.xBucketSizeMs;
}
