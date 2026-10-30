import { html } from 'htl';
import { Disposable } from '../../core/disposable/disposable';
import type { Extension } from '../../hosts/extension-host/extension-host';
import { chartSearch } from './ui/chart-search';
import { commandSearch } from './ui/command-search';
import { SearchPick } from './ui/search-pick';
import './search-everywhere.css';

const SEARCH_EVERYWHERE = 'workbench.action.searchEverywhere';

/**
 * Search everywhere: one quick pick over everything the search providers find (`ui.registerSearchProvider`:
 * dashboards, …), plus its own groups, the charts of every page and the declared commands (`>`). It opens with ⌘K
 * (Ctrl+K), double Shift outside a text field, ⌘⇧A for commands, its button in the title bar, and the command
 * `workbench.action.searchEverywhere` (its argument: the text to start with, e.g. a prefix).
 */
export const searchEverywhere: Extension = {
  id: 'searchEverywhere',
  contributes: {
    keybindings: [
      // first: the key the title bar button names
      { command: SEARCH_EVERYWHERE, key: 'Mod+KeyK' },
      { command: SEARCH_EVERYWHERE, key: 'Shift Shift' },
      { command: SEARCH_EVERYWHERE, key: 'Mod+Shift+KeyA', args: '>' },
    ],
  },
  activate({ commands, ui, page, subscriptions }) {
    const search = new SearchPick(ui);
    const key = commands.keybindingLabel(SEARCH_EVERYWHERE) ?? '';
    const button = html`<button type="button" class="d-search-button" onclick=${() => search.show()}><span>Search</span> <kbd class="d-kbd">${key}</kbd></button>`;
    subscriptions.push(new Disposable(() => search.dispose()));
    subscriptions.push(commands.registerCommand(SEARCH_EVERYWHERE, (value?: unknown) => search.show(typeof value === 'string' ? value : '')));
    subscriptions.push(ui.registerBarItem('title', button, { alignment: 'center' }));
    subscriptions.push(ui.registerSearchProvider(chartSearch(page)));
    subscriptions.push(ui.registerSearchProvider(commandSearch(commands)));
  },
};
