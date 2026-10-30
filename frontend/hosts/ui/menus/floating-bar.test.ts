// @vitest-environment jsdom
// Tests for floating-bar.ts, over menus of its own and commands faked.
import { afterEach, describe, expect, it } from 'vitest';
import type { CommandsHost, MenuItem } from '../../commands/commands';
import { FloatingBars } from './floating-bar';
import { Menus } from './menus';

afterEach(() => document.body.replaceChildren());

interface Picked {
  readonly kind: 'category' | 'time';
  readonly value: string;
}

/** The menu `widget/selection` as extensions might fill it: one entry only for a category, one for any selection. */
const ENTRIES: MenuItem<Picked>[] = [
  { command: 'filters.filterBySelection', title: 'Filter by', when: (picked) => picked.kind === 'category' },
  { command: 'chartLink.copy', title: 'Copy link', order: 1 },
];

function setup() {
  const host = document.body.appendChild(document.createElement('div'));
  const menus = new Menus(() => []);
  for (const item of ENTRIES) menus.register('widget/selection', item);
  const ran: unknown[][] = [];
  const commands = { executeCommand: async (command: string, ...args: unknown[]) => void ran.push([command, ...args]) } as Pick<CommandsHost, 'executeCommand'>;
  const bars = new FloatingBars(host, menus, commands);
  let anchor: DOMRect | null = new DOMRect(30, 200, 10, 40);
  const bar = bars.register<Picked>({ id: 'widget/selection', title: 'Selection', anchor: () => anchor });
  const shown = () => host.querySelector<HTMLElement>('[role=toolbar]');
  const entries = () => [...(shown()?.querySelectorAll('button') ?? [])].map((button) => button.textContent);
  return { host, menus, bars, bar, ran, shown, entries, moveAnchor: (rect: DOMRect | null) => (anchor = rect) };
}

describe('FloatingBars', () => {
  it('shows the entries whose `when` holds for the context, at the anchor, without taking the focus', () => {
    const { bar, shown, entries } = setup();
    const before = document.activeElement;
    bar.show({ kind: 'category', value: '500' });
    expect(shown()!.getAttribute('aria-label')).toBe('Selection');
    expect(entries()).toEqual(['Filter by', 'Copy link']);
    expect(shown()!.style.left).toBe('30px');
    expect(document.activeElement).toBe(before);
    bar.show({ kind: 'time', value: '' });
    expect(entries()).toEqual(['Copy link']);
  });

  it('runs a chosen entry’s command with the context, and stays', async () => {
    const { bar, ran, shown } = setup();
    const picked: Picked = { kind: 'category', value: '500' };
    bar.show(picked);
    shown()!.querySelector('button')!.click();
    await Promise.resolve();
    expect(ran).toEqual([['filters.filterBySelection', picked]]);
    expect(shown()).not.toBeNull();
  });

  it('goes away on hide, and is not shown while no entry applies', () => {
    const { bar, menus, shown } = setup();
    bar.show({ kind: 'category', value: '500' });
    bar.hide();
    expect(shown()).toBeNull();
    const empty = new FloatingBars(document.body, menus, { executeCommand: async () => undefined } as Pick<CommandsHost, 'executeCommand'>).register<Picked>({ id: 'table/row', title: 'Row', anchor: () => new DOMRect() });
    empty.show({ kind: 'category', value: '' });
    expect(document.body.querySelector('[aria-label=Row]')).toBeNull();
  });

  it('hides while its anchor is gone, and follows it on scrolling', () => {
    const { bar, shown, moveAnchor } = setup();
    bar.show({ kind: 'category', value: '500' });
    moveAnchor(new DOMRect(60, 200, 10, 40));
    document.dispatchEvent(new Event('scroll'));
    expect(shown()!.style.left).toBe('60px');
    moveAnchor(null);
    document.dispatchEvent(new Event('scroll'));
    expect(shown()!.hidden).toBe(true);
  });

  it('shows the entries its menu gains while it shows', () => {
    const { bar, menus, entries } = setup();
    bar.show({ kind: 'time', value: '' });
    menus.register<Picked>('widget/selection', { command: 'timeRange.zoom', title: 'Zoom', when: (picked) => picked.kind === 'time' });
    expect(entries()).toEqual(['Zoom', 'Copy link']);
  });

  it('puts a bar of a higher order above the others, and refuses a second bar with an id', () => {
    const { host, menus, bars, bar } = setup();
    menus.register<Picked>('widget/higher', { command: 'chartLink.copy', title: 'Copy link' });
    const higher = bars.register<Picked>({ id: 'widget/higher', title: 'Higher', order: 1, anchor: () => new DOMRect() });
    higher.show({ kind: 'category', value: '' });
    bar.show({ kind: 'category', value: '500' });
    expect([...host.querySelectorAll('[role=toolbar]')].map((shown) => shown.getAttribute('aria-label'))).toEqual(['Selection', 'Higher']);
    expect(() => bars.register<Picked>({ id: 'widget/selection', title: '', anchor: () => null })).toThrow('There is a floating bar widget/selection already');
  });
});
