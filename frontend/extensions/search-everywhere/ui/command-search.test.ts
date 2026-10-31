// @vitest-environment jsdom
// Tests for command-search.ts, over real commands.
import { describe, expect, it } from 'vitest';
import { CommandsHost } from '../../../hosts/commands/commands';
import type { SearchItem } from '../../../hosts/ui/ui';
import { commandSearch } from './command-search';

describe('commandSearch', () => {
  it('lists the declared commands with their keys, one that cannot run now greyed with its reason', async () => {
    const commands = new CommandsHost(document.createElement('div'));
    const ran: string[] = [];
    let explore = false;
    commands.declareCommands([{ command: 'refresh.now', title: 'Refresh', category: 'Time range' }, { command: 'exploreView.open', title: 'Explore' }]);
    commands.declareKeybindings([{ key: 'Mod+KeyR', command: 'refresh.now' }]);
    commands.registerCommand('refresh.now', () => ran.push('refresh'));
    commands.registerCommand('exploreView.open', () => ran.push('explore'), { enablement: () => explore, disabledReason: 'Explore is not enabled (explore.enabled)' });
    const items = () => commandSearch(commands).provideItems('', undefined as never) as readonly SearchItem[];
    expect(items().map(({ label, keybinding, disabled, tooltip }) => ({ label, keybinding, disabled, tooltip }))).toEqual([
      { label: 'Time range: Refresh', keybinding: 'Ctrl+R', disabled: undefined, tooltip: undefined },
      { label: 'Explore', keybinding: undefined, disabled: true, tooltip: 'Explore is not enabled (explore.enabled)' },
    ]);
    explore = true;
    expect(items()[1].disabled).toBeUndefined();
    await items()[0].accept();
    expect(ran).toEqual(['refresh']);
  });
});
