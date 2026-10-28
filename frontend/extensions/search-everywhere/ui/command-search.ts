// See searchEverywhere in ../search-everywhere.ts.
import type { Commands } from '../../../hosts/commands/commands';
import type { SearchProvider } from '../../../hosts/ui/ui';

/**
 * "Commands" (prefix `>`): every declared command that is registered, as "Category: Title" with its key; picking one
 * runs it without arguments.
 */
export function commandSearch(commands: Pick<Commands, 'getCommands' | 'keybindingLabel' | 'executeCommand'>): SearchProvider {
  return {
    id: 'searchEverywhere.commands',
    label: 'Commands',
    prefix: '>',
    order: 40,
    provideItems: () =>
      commands.getCommands().map(({ command, title, category }) => ({
        label: category ? `${category}: ${title}` : title,
        keybinding: commands.keybindingLabel(command),
        accept: () => commands.executeCommand(command),
      })),
  };
}
