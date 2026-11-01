import { html } from 'htl';
import type { StatsProps } from '../../generated/zz_generated.dashica';
import type { Extension } from '../../hosts/extension-host/extension-host';
import type { QueryResult, WidgetContext, WidgetOf } from '../../hosts/widgets/widgets';
import { ChartFrame } from '../chart-library/chart-frame';
import { SchemaAnalyzer } from '../chart-library/schema';
import './stats.css';

/**
 * The widget type `stats`: one big number per result row (its `value` column) under its label (its `label` column, or
 * the `titleField`), in the color of its `color` column, if any.
 */
export const stats: Extension = {
  id: 'stats',
  activate: ({ widgets, subscriptions }) => subscriptions.push(widgets.registerWidget('stats', renderStats)),
};

function renderStats(widgetContainer: HTMLElement, widget: WidgetOf<'stats'>, ctx: WidgetContext): ChartFrame {
  return new ChartFrame(widgetContainer, ctx, {
    draw: (result) => drawStats(result, widget.props),
  });
}

/** A row of the result. */
interface Stat {
  label?: string;
  value: number;
  color?: string;
}

// TODO: fixed colors for different levels??
/** A known bug: `fillField`'s alias is taken as the color itself, where it is meant as the column of each number's color. */
function drawStats(data: QueryResult, props: StatsProps): HTMLElement {
  const schema = new SchemaAnalyzer(data);
  if (!props.titleField) {
    schema.requiredColumn('label');
  }
  schema.requiredColumn('value');
  const rows = data.toArray() as Stat[];

  return html`<dl class="d-stats">
    ${rows.map((stat) => drawStat(stat, props))}
  </dl>`;
}

function drawStat(stat: Stat, props: StatsProps): HTMLElement {
  const color = stat.color ?? props.fillField?.alias ?? 'oklch(0.21 0.034 264.665)';
  return html`<div class="d-stats__stat">
    <dt>${stat.label ?? props.titleField?.alias}</dt>
    <dd style=${{ color }}>${Math.round(stat.value * 100) / 100}</dd>
  </div>`;
}
