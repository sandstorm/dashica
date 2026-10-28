// See registerMenuItem in ../ui.ts.
import { Disposable } from '../../../core/disposable/disposable';
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import type { CommandContribution, MenuItem } from '../../commands/commands';

/**
 * Every menu's registered entries. A menu is only an id: whoever shows it (`ui.showContextMenu`) asks for the entries
 * that apply in its context (`items`): group `navigation` first, the other groups by name, within a group by `order`,
 * then registration order. An entry without a title or icon of its own shows its command's.
 */
export class Menus {
  // each menu's entries take the context its shower documents: kept as any, typed again by who asks
  readonly #items = new Map<string, MenuItem<any>[]>();
  readonly #changed = new EventEmitter<string>();
  readonly onDidChange = this.#changed.event;

  /** `declared`: the declared commands, whose titles and icons entries show by default. */
  constructor(private readonly declared: () => readonly CommandContribution[]) {}

  register<C extends object>(menuId: string, item: MenuItem<C>): Disposable {
    this.#items.set(menuId, [...(this.#items.get(menuId) ?? []), item]);
    this.#changed.fire(menuId);
    return new Disposable(() => {
      const left = (this.#items.get(menuId) ?? []).filter((other) => other !== item);
      if (left.length > 0) this.#items.set(menuId, left);
      else this.#items.delete(menuId);
      this.#changed.fire(menuId);
    });
  }

  /** The entries of `menuId` whose `when` holds in `context`, sorted, with their titles and icons. */
  items<C extends object>(menuId: string, context: C = {} as C): readonly MenuItem<C>[] {
    const items: MenuItem<C>[] = this.#items.get(menuId) ?? [];
    const declared = new Map(this.declared().map((command) => [command.command, command]));
    return items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.when?.(context) ?? true)
      .sort((a, b) => compareGroups(a.item.group ?? '', b.item.group ?? '') || (a.item.order ?? 0) - (b.item.order ?? 0) || a.index - b.index)
      .map(({ item }) => {
        const command = declared.get(item.command);
        return { ...item, title: item.title ?? command?.title ?? item.command, icon: item.icon ?? command?.icon };
      });
  }

  dispose(): void {
    this.#items.clear();
    this.#changed.dispose();
  }
}

function compareGroups(a: string, b: string): number {
  if (a === b) return 0;
  if (a === 'navigation') return -1;
  if (b === 'navigation') return 1;
  return a < b ? -1 : 1;
}
