import './index.css';
import './tabulator-theme.css';
import type { WorkbenchJson } from './generated/zz_generated.dashica';
import type { Extension } from './hosts/extension-host/extension-host';
import { createWorkbench } from './workbench/workbench';
import { alerts } from './extensions/alerts/alerts';
import { barHorizontal } from './extensions/bar-horizontal/bar-horizontal';
import { barVertical } from './extensions/bar-vertical/bar-vertical';
import { checkboxGroup } from './extensions/checkbox-group/checkbox-group';
import { collapsible } from './extensions/collapsible/collapsible';
import { dashboardPage } from './extensions/dashboard-page/dashboard-page';
import { dashboards } from './extensions/dashboards/dashboards';
import { debug } from './extensions/debug/debug';
import { filters } from './extensions/filters/filters';
import { grid } from './extensions/grid/grid';
import { heatmap } from './extensions/heatmap/heatmap';
import { markdown } from './extensions/markdown/markdown';
import { schemaTable } from './extensions/schema-table/schema-table';
import { refresh } from './extensions/refresh/refresh';
import { searchEverywhere } from './extensions/search-everywhere/search-everywhere';
import { speedscopeLink } from './extensions/speedscope-link/speedscope-link';
import { stats } from './extensions/stats/stats';
import { table } from './extensions/table/table';
import { textInput } from './extensions/text-input/text-input';
import { timeBar } from './extensions/time-bar/time-bar';
import { timeLine } from './extensions/time-line/time-line';
import { timeRange } from './extensions/time-range/time-range';

/** The workbench's extensions: the chrome first (its title bar items in this order), then the page and widget types. */
const EXTENSIONS: readonly Extension[] = [
  dashboards,
  searchEverywhere,
  timeRange,
  refresh,
  filters,
  debug,
  dashboardPage,
  grid,
  collapsible,
  markdown,
  schemaTable,
  timeBar,
  timeLine,
  barVertical,
  barHorizontal,
  heatmap,
  stats,
  table,
  alerts,
  checkboxGroup,
  textInput,
  speedscopeLink,
];

declare global {
  interface Window {
    Dashica: { boot(): Promise<void> };
  }
}

/**
 * The entry of the bundle: the shell (lib/dashboard/shell.go) calls `boot`, which loads `/workbench.json` and starts the
 * workbench in `#workbench`; it shows the page of the URL.
 */
window.Dashica = {
  async boot() {
    const host = document.getElementById('workbench')!;
    let workbench: WorkbenchJson;
    try {
      const response = await fetch('/workbench.json');
      if (!response.ok) throw new Error(`/workbench.json: ${response.status} ${await response.text()}`);
      workbench = await response.json();
    } catch (error) {
      host.textContent = error instanceof Error ? error.message : String(error);
      host.className = 'd-notice d-notice--error';
      return;
    }
    createWorkbench(host, { extensions: EXTENSIONS, workbench });
  },
};
