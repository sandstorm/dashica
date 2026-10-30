// @vitest-environment jsdom
// Tests for search-pick.ts (SearchPick) over a UiHost: groups, matching, prefixes, async providers and picking.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CancellationToken } from '../../../core/cancellation/cancellation';
import { CommandsHost } from '../../../hosts/commands/commands';
import { type SearchItem, type SearchProvider, UiHost } from '../../../hosts/ui/ui';
import { SearchPick } from './search-pick';

afterEach(() => document.body.replaceChildren());

function setup(...providers: SearchProvider[]) {
  const host = document.body.appendChild(document.createElement('div'));
  const ui = new UiHost(host, { get: () => undefined, update: async () => {} }, new CommandsHost(host));
  const search = new SearchPick(ui);
  for (const provider of providers) ui.registerSearchProvider(provider);
  const field = () => host.querySelector<HTMLInputElement>('.d-workbench__quick-pick input')!;
  const type = (value: string) => {
    field().value = value;
    field().dispatchEvent(new Event('input'));
  };
  /** The rows shown: `# Heading` for a group's heading, else the item's text. */
  const rows = () =>
    [...host.querySelectorAll<HTMLElement>('.d-workbench__quick-pick-heading, [role=option]')].map((row) =>
      row.getAttribute('role') === 'option' ? row.textContent : `# ${row.textContent}`,
    );
  const marked = () => [...host.querySelectorAll('mark')].map((mark) => mark.textContent);
  return { host, ui, search, field, type, rows, marked };
}

function items(...labels: string[]): SearchItem[] {
  return labels.map((label) => ({ label, accept: vi.fn() }));
}

function provider(id: string, labels: string[], more: Partial<SearchProvider> = {}): SearchProvider {
  return { id, label: id, provideItems: () => items(...labels), ...more };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('SearchPick', () => {
  it('shows every provider as a group in `order`, matching fuzzily and marking the matches', () => {
    const { search, type, rows, marked } = setup(
      provider('Alerts', ['Shop login events', 'Ingress errors', 'Disk full'], { order: 20 }),
      provider('Dashboards', ['Shop overview', 'Billing'], { order: 10 }),
    );
    search.show();
    expect(rows()).toEqual(['# Dashboards', 'Shop overview', 'Billing', '# Alerts', 'Shop login events', 'Ingress errors', 'Disk full']);
    type('sho');
    expect(rows()).toEqual(['# Dashboards', 'Shop overview', '# Alerts', 'Shop login events']);
    expect(marked()).toEqual(['Sho', 'Sho']);
    type('nothing like it');
    expect(rows()).toEqual([]);
    expect(document.querySelector<HTMLElement>('.d-workbench__quick-pick-empty')!.hidden).toBe(false);
  });

  it('matches the description when the label does not match, ranked below label matches', () => {
    const { search, type, rows } = setup({
      id: 'dashboards',
      label: 'Dashboards',
      provideItems: () => [
        { label: 'Logs', description: 'Shop', accept() {} },
        { label: 'Shop overview', description: 'Shop', accept() {} },
      ],
    });
    search.show();
    type('shop');
    expect(rows()).toEqual(['# Dashboards', 'Shop overview Shop', 'Logs Shop']);
  });

  it('narrows to the providers of a prefix, which show more, and says how in the hint and the headings', () => {
    const labels = Array.from({ length: 8 }, (_, i) => `Refresh ${i + 1}`);
    const { host, search, type, rows } = setup(provider('Commands', labels, { prefix: '>', order: 10 }), provider('Dashboards', ['Refresh rates']));
    search.show();
    expect(host.querySelector('.d-workbench__quick-pick-hint')!.textContent).toBe('Narrow with > Commands');
    expect(rows()[0]).toBe('# Commands 3 more · type >');
    expect(rows()).toHaveLength(5 + 1 + 2);
    type('>refr');
    expect(rows()).toEqual(['# Commands', ...labels]);
    type('> 8');
    expect(rows()).toEqual(['# Commands', 'Refresh 8']);
  });

  it('narrows a prefix to every provider sharing it, and names it once in the hint', () => {
    const { host, search, type, rows } = setup(provider('Commands', ['Refresh now'], { prefix: '>', order: 40 }), provider('Actions', ['Refresh cache'], { prefix: '>', order: 41 }));
    search.show();
    expect(host.querySelector('.d-workbench__quick-pick-hint')!.textContent).toBe('Narrow with > Commands');
    type('>refresh');
    expect(rows()).toEqual(['# Commands', 'Refresh now', '# Actions', 'Refresh cache']);
  });

  it('opens with a value, e.g. a prefix', () => {
    const { search, field, rows } = setup(provider('Commands', ['Refresh now'], { prefix: '>' }), provider('Dashboards', ['Shop overview']));
    search.show('>');
    expect(field().value).toBe('>');
    expect(rows()).toEqual(['# Commands', 'Refresh now']);
  });

  it('shows items a provider matched itself as given, in its order, after its async answer, cancelling earlier rounds', async () => {
    const tokens: CancellationToken[] = [];
    const server: SearchProvider = {
      id: 'logs',
      label: 'Logs',
      provideItems: async (query, token) => {
        tokens.push(token);
        await tick();
        return query ? [{ label: `GET /${query} 500`, highlights: { label: [[5, 5 + query.length]] }, accept() {} }] : [];
      },
    };
    const { host, search, type, rows, marked } = setup(server, provider('Dashboards', ['Shop overview']));
    search.show();
    type('login');
    const progress = host.querySelector<HTMLElement>('.d-workbench__quick-pick-progress')!;
    expect(progress.hidden).toBe(false);
    expect(tokens.map((token) => token.isCancellationRequested)).toEqual([true, false]);
    await tick();
    expect(rows()).toEqual(['# Logs', 'GET /login 500']);
    expect(marked()).toEqual(['login']);
    expect(progress.hidden).toBe(true);
    search.dispose();
    expect(tokens[1].isCancellationRequested).toBe(true);
  });

  it('runs the picked item once the search is closed and the focus is back', () => {
    const { host, ui, search, field, rows } = setup(provider('Dashboards', ['Shop overview', 'Billing']));
    const button = host.appendChild(document.createElement('button'));
    button.focus();
    const picked = vi.fn(() => expect([document.activeElement, host.querySelector('.d-workbench__quick-pick')]).toEqual([button, null]));
    ui.registerSearchProvider({ id: 'more', label: 'More', provideItems: () => [{ label: 'Billing alerts', accept: picked }] });
    search.show();
    expect(rows()).toContain('Billing alerts');
    search.show('alerts');
    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(picked).toHaveBeenCalledTimes(1);
  });

  it('logs a failing provider and shows the others', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing: SearchProvider = {
      id: 'failing',
      label: 'Failing',
      provideItems: () => {
        throw new Error('broken');
      },
    };
    const { search, rows } = setup(failing, provider('Dashboards', ['Shop overview']));
    search.show();
    expect(rows()).toEqual(['# Dashboards', 'Shop overview']);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('refuses a second provider with the same id', () => {
    const { ui } = setup(provider('Dashboards', []));
    expect(() => ui.registerSearchProvider(provider('Dashboards', []))).toThrow();
  });
});
