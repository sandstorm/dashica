// Tests for offer.ts: a click's candidates handed to the command filters.offer with the widget's pills.
import { describe, expect, it, vi } from 'vitest';
import type { Commands } from '../../hosts/commands/commands';
import { OFFER, offerFiltersOf } from './offer';

describe('offerFiltersOf', () => {
  it('runs filters.offer with the click’s point, its candidates and the widget’s dataUrl and filterable only', () => {
    const runs: unknown[][] = [];
    const commands = { executeCommand: async (id: string, ...args: unknown[]) => void runs.push([id, ...args]) } as Pick<Commands, 'executeCommand'>;
    const widget = { type: 'table', dataUrl: '/p/shop/api/1', filterable: ['host'], props: {} };
    offerFiltersOf(commands, widget)({ x: 3, y: 4 }, [{ fieldId: 'host', value: 'a' }]);
    expect(runs).toEqual([[OFFER, { x: 3, y: 4 }, [{ fieldId: 'host', value: 'a' }], { dataUrl: '/p/shop/api/1', filterable: ['host'] }]]);
  });

  it('tells the console when the command fails, e.g. without the filters extension', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    offerFiltersOf({ executeCommand: () => Promise.reject(new Error('no command filters.offer')) }, { dataUrl: '/p/shop/api/1' })({ x: 0, y: 0 }, []);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(logged).toHaveBeenCalledWith('Command filters.offer failed:', expect.any(Error));
    logged.mockRestore();
  });
});
