// See exploreView in explore-view.ts.
import type { SqlFieldProps, WidgetNode } from '../../generated/zz_generated.dashica';

/** What `<perspective-viewer>`'s `restore` takes, as far as the Explore view sets it. */
export interface ViewerConfig {
  plugin?: string;
  group_by?: string[];
  split_by?: string[];
  columns?: (string | null)[];
  aggregates?: Record<string, string>;
  expressions?: Record<string, string>;
  filter?: [string, string, unknown][];
  sort?: [string, string][];
  [key: string]: unknown;
}

/** The rows the view shows, as far as the mapping needs them. */
export interface RowsShape {
  /** `result`: the chart's result, its columns the chart's aliases; `ungrouped`: its rows without grouping. */
  readonly kind: 'result' | 'ungrouped';
  /** The rows' column names. */
  readonly columns: readonly string[];
}

/** The viewer's first config for a widget, and what it could not rebuild of the chart ("`fill` (`status`) is not a column"). */
export interface InitialView {
  readonly config: ViewerConfig;
  readonly notes: readonly string[];
}

/**
 * The viewer config that rebuilds `widget`'s chart on its result: its plugin, the dimensions as `group_by` /
 * `split_by` and the measure as `columns`, each by its alias (a column of the result), a count summed, any other
 * measure its last value. A dimension the result lacks is left out, with a note. Rows without grouping start as a
 * datagrid of all their columns.
 */
export function initialView(widget: WidgetNode, rows: RowsShape): InitialView {
  const view = new ViewBuilder(rows);
  if (rows.kind === 'ungrouped') return view.build();
  switch (widget.type) {
    case 'timeBar':
    case 'barVertical':
      view.plugin('Y Bar').group('x', widget.props.x).group('fx', widget.props.fx).group('fy', widget.props.fy).split('fill', widget.props.fill).measure('y', widget.props.y);
      break;
    case 'timeLine':
      view
        .plugin('Y Line')
        .group('x', widget.props.x)
        .group('fx', widget.props.fx)
        .group('fy', widget.props.fy)
        .split('strokeField', widget.props.strokeField ?? widget.props.zField)
        .measure('y', widget.props.y);
      break;
    case 'barHorizontal':
      view.plugin('X Bar').group('y', widget.props.y).split('fill', widget.props.fill).measure('x', widget.props.x);
      break;
    case 'timeHeatmap':
    case 'timeHeatmapOrdinal':
      view.plugin('Heatmap').group('x', widget.props.x).split('y', widget.props.y).measure('fill', widget.props.fill);
      break;
    case 'stats':
      view.group('titleField', widget.props.titleField);
      break;
  }
  return view.build();
}

/** Collects one widget's config slot by slot; `build` gives it with its notes. */
class ViewBuilder {
  readonly #groupBy: string[] = [];
  readonly #splitBy: string[] = [];
  readonly #notes: string[] = [];
  #plugin = 'Datagrid';
  #measure: { column: string; aggregate: string } | undefined;

  constructor(private readonly rows: RowsShape) {}

  plugin(name: string): this {
    this.#plugin = name;
    return this;
  }

  group(slot: string, field: SqlFieldProps | undefined): this {
    const column = this.#column(slot, field);
    if (column) this.#groupBy.push(column);
    return this;
  }

  split(slot: string, field: SqlFieldProps | undefined): this {
    const column = this.#column(slot, field);
    if (column) this.#splitBy.push(column);
    return this;
  }

  /** The measure: its column, summed for a count (group totals add up), else its last value (one row per group already). */
  measure(slot: string, field: SqlFieldProps | undefined): this {
    const column = this.#column(slot, field);
    if (column) this.#measure = { column, aggregate: field!.kind === 'count' ? 'sum' : 'last' };
    return this;
  }

  build(): InitialView {
    const config: ViewerConfig = {
      plugin: this.#plugin,
      group_by: this.#groupBy,
      split_by: this.#splitBy,
      columns: this.#measure ? [this.#measure.column] : [...this.rows.columns],
      aggregates: this.#measure ? { [this.#measure.column]: this.#measure.aggregate } : {},
      expressions: {},
      filter: [],
      sort: [],
    };
    return { config, notes: [...this.#notes] };
  }

  /** `field`'s alias when the rows have that column; else a note, and `undefined`. */
  #column(slot: string, field: SqlFieldProps | undefined): string | undefined {
    if (!field) return undefined;
    if (this.rows.columns.includes(field.alias)) return field.alias;
    this.#notes.push(`\`${slot}\` (\`${field.alias}\`) is not a column of the chart’s result`);
    return undefined;
  }
}
