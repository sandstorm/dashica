import { Search, createElement } from 'lucide';
import { Disposable } from '../../core/disposable/disposable';
import type { Extension } from '../../hosts/extension-host/extension-host';
import { chartSearch } from './providers/chart-search';
import { commandSearch } from './providers/command-search';
import { SearchPick } from './search-pick';

const SEARCH_EVERYWHERE = 'workbench.action.searchEverywhere';

/**
 * Search everywhere: one quick pick over everything the search providers find (`ui.registerSearchProvider`:
 * dashboards, …), plus its own groups, the charts of every page and the declared commands (`>`). It opens with ⌘K
 * (Ctrl+K), double Shift outside a text field, ⌘⇧A for commands, its button in the left rail, and the command
 * `workbench.action.searchEverywhere` (its argument: the text to start with, e.g. a prefix).
 */
export const searchEverywhere: Extension = {
  id: 'searchEverywhere',
  contributes: {
    keybindings: [
      // first: the key the rail button's tooltip names
      { command: SEARCH_EVERYWHERE, key: 'Mod+KeyK' },
      { command: SEARCH_EVERYWHERE, key: 'Shift Shift' },
      { command: SEARCH_EVERYWHERE, key: 'Mod+Shift+KeyA', args: '>' },
    ],
  },
  activate({ commands, ui, page, subscriptions }) {
    const search = new SearchPick(ui);
    subscriptions.push(new Disposable(() => search.dispose()));
    subscriptions.push(commands.registerCommand(SEARCH_EVERYWHERE, (value?: unknown) => search.show(typeof value === 'string' ? value : '')));
    // first in the rail, before the panels
    subscriptions.push(ui.registerRailButton('search', { label: 'Search everywhere', icon: createElement(Search).outerHTML, command: SEARCH_EVERYWHERE, order: -100 }));
    subscriptions.push(ui.registerSearchProvider(chartSearch(page)));
    subscriptions.push(ui.registerSearchProvider(commandSearch(commands)));
  },
};
