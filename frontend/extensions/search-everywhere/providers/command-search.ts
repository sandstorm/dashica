// See searchEverywhere in ../search-everywhere.ts.
import type { Commands } from '../../../hosts/commands/commands';
import type { SearchProvider } from '../../../hosts/ui/ui';

/**
 * "Commands" (prefix `>`): every declared command that is registered, as "Category: Title" with its key, greyed with
 * its `disabledReason` on hover while it cannot run (`Commands.enablement`); picking one runs it without arguments.
 */
export function commandSearch(commands: Pick<Commands, 'getCommands' | 'keybindingLabel' | 'executeCommand' | 'enablement'>): SearchProvider {
  return {
    id: 'searchEverywhere.commands',
    label: 'Commands',
    prefix: '>',
    order: 40,
    provideItems: () =>
      commands.getCommands().map(({ command, title, category }) => {
        const { enabled, disabledReason } = commands.enablement(command);
        return {
          label: category ? `${category}: ${title}` : title,
          keybinding: commands.keybindingLabel(command),
          disabled: enabled ? undefined : true,
          tooltip: disabledReason,
          accept: () => commands.executeCommand(command),
        };
      }),
  };
}
