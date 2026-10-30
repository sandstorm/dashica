// Tests for menus.ts.
import { describe, expect, it } from 'vitest';
import type { CommandContribution } from '../../commands/commands';
import { Menus } from './menus';

describe('Menus', () => {
  it('sorts the entries: navigation first, the other groups by name, by order, then registration order', () => {
    const menus = new Menus(() => []);
    menus.register('dashboards/entry', { command: 'favorites.add', title: 'Add to favorites', group: 'favorites' });
    menus.register('dashboards/entry', { command: 'dashboards.copyLink', title: 'Copy link', group: 'navigation', order: 2 });
    menus.register('dashboards/entry', { command: 'dashboards.openInNewTab', title: 'Open in new tab', group: 'navigation', order: 1 });
    menus.register('dashboards/entry', { command: 'debug.showWidget', title: 'Show query', group: 'debug' });
    expect(menus.items('dashboards/entry').map((item) => item.title)).toEqual(['Open in new tab', 'Copy link', 'Show query', 'Add to favorites']);
  });

  it("leaves out entries whose `when` does not hold in the menu's context", () => {
    const menus = new Menus(() => []);
    menus.register<{ favorite: boolean }>('dashboards/entry', { command: 'favorites.remove', title: 'Remove from favorites', when: (context) => context.favorite });
    expect(menus.items('dashboards/entry', { favorite: false })).toEqual([]);
    expect(menus.items('dashboards/entry', { favorite: true })).toHaveLength(1);
  });

  it("shows a declared command's title and icon for an entry without its own, else the command id", () => {
    const declared: CommandContribution[] = [{ command: 'timeRange.refresh', title: 'Refresh', icon: '<svg></svg>' }];
    const menus = new Menus(() => declared);
    menus.register('page/title', { command: 'timeRange.refresh' });
    menus.register('page/title', { command: 'debug.showWidget' });
    expect(menus.items('page/title').map(({ title, icon }) => [title, icon])).toEqual([
      ['Refresh', '<svg></svg>'],
      ['debug.showWidget', undefined],
    ]);
  });

  it('tells which menu changed, on register and on dispose', () => {
    const menus = new Menus(() => []);
    const changed: string[] = [];
    menus.onDidChange((menuId) => changed.push(menuId));
    const registration = menus.register('page/title', { command: 'timeRange.refresh' });
    registration.dispose();
    expect(changed).toEqual(['page/title', 'page/title']);
    expect(menus.items('page/title')).toEqual([]);
  });
});
