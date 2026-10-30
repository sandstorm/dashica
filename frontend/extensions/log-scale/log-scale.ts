import type { Extension } from '../../hosts/extension-host/extension-host';

/**
 * The log scale, an entry of the title bar's "⋮" menu (`titleBar/more`, checked while on) and the command
 * `logScale.toggle`: turns `query.viewOptions.logScale` (`?log=1`) on or off, which every chart reads.
 */
export const logScale: Extension = {
  id: 'logScale',
  contributes: {
    commands: [{ command: 'logScale.toggle', title: 'Log scale', category: 'View' }],
  },
  activate({ ui, query, commands, subscriptions }) {
    subscriptions.push(commands.registerCommand('logScale.toggle', () => query.viewOptions.setLogScale(!query.viewOptions.logScale)));
    subscriptions.push(ui.registerMenuItem('titleBar/more', { command: 'logScale.toggle', toggled: () => query.viewOptions.logScale }));
  },
};
