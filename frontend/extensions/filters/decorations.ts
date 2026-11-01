// See filterDecorations.
import type { WidgetDecoration, WidgetDecorationProvider } from '../../hosts/widgets/widgets';
import { diagnosticsOf, type Diagnostics } from '../filter-library/diagnostics';

/**
 * What a chart's Diagnostics show on it (docs/2026-10-28-workbench.md §3.8, §3.15 D38): a chart that did not run says
 * why ("skipped: pick a host"), else each pill it ignores is a badge "ignores <label>" with the chart drawn muted
 * (D28): what it draws holds only part of what the page filters.
 */
export function filterDecorations({ ignored = [], skipped }: Diagnostics): WidgetDecoration[] {
  if (skipped) return [{ badge: `skipped: ${skipped}`, tooltip: 'The chart did not run', source: SOURCE }];
  return ignored.map((label) => ({ badge: `ignores ${label}`, tooltip: `The chart does not apply the filter ${label}`, muted: true, source: SOURCE }));
}

/** The `filters` extension's decorations of every widget's answer, from its X-Dashica-Diagnostics. */
export const filterDecorationProvider: WidgetDecorationProvider = {
  provideDecorations: (_widget, result) => filterDecorations(diagnosticsOf(result)),
};

/** The decorations' source, as Debug lists it: the extension's id. */
const SOURCE = 'filters';
