// See UiApi in ../ui.ts.
import type { CommandsHost } from '../../commands/commands';
import type { QuickInput } from '../quick-input/quick-input';
import { type ContextMenuOptions, type QuickPickItem, QuickPickItemKind, type QuickPickSeparator } from '../ui';
import type { Menus } from './menus';

/**
 * What `showContextMenu` shows: the menu's entries in the quick pick at the anchor (typing narrows them), a line
 * between groups, an entry with `toggled` with a check mark while it holds, one that is not `enabled` greyed, an
 * entry's key at its end and its `tooltip` on hover. Choosing an
 * entry closes the box and gives the focus back; its command runs right after, still in the viewer's gesture (a
 * failing one is logged). A menu without entries hides the open box and shows nothing.
 */
export class ContextMenu {
  constructor(
    private readonly quickInput: Pick<QuickInput, 'pickOne' | 'hide'>,
    private readonly menus: Menus,
    /** Runs a chosen entry's command with the menu's arguments; names the entries' keys. */
    private readonly commands: Pick<CommandsHost, 'executeCommand' | 'keybindingLabel'>,
  ) {}

  show(menuId: string, options: ContextMenuOptions): void {
    const context = options.context ?? {};
    const args = options.args ?? [];
    const picks: (MenuPick | QuickPickSeparator)[] = [];
    let group: string | undefined;
    for (const item of this.menus.items(menuId, context)) {
      if (group !== undefined && (item.group ?? '') !== group) picks.push({ kind: QuickPickItemKind.Separator });
      group = item.group ?? '';
      picks.push({
        label: item.title ?? item.command,
        keybinding: this.commands.keybindingLabel(item.command),
        checked: item.toggled?.(context),
        disabled: item.enabled ? !item.enabled(context) : undefined,
        tooltip: item.tooltip,
        command: item.command,
      });
    }
    if (picks.length === 0) {
      this.quickInput.hide();
      return;
    }
    this.quickInput.pickOne(picks, { title: options.title, anchor: options.anchor }, (picked) => {
      if (picked) this.#run(picked.command, args);
    });
  }

  #run(command: string, args: readonly unknown[]): void {
    this.commands.executeCommand(command, ...args).catch((error: unknown) => console.error(`Command ${command} failed:`, error));
  }
}

/** An entry of the menu shown: its command, run when it is chosen. */
interface MenuPick extends QuickPickItem {
  readonly command: string;
}
