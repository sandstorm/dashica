// Tests for explorePerspective in perspective.ts, the Perspective packages faked: the worker starts once the viewer's
// wasm defined `<perspective-viewer>`, and a failed start is tried again.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  /** The viewer's `init_client` calls, each settled by the test. */
  inits: [] as { resolve(): void; reject(error: Error): void }[],
  workers: 0,
  failWorker: false,
}));

vi.mock('@perspective-dev/client', () => ({
  default: {
    init_server: () => {},
    worker: async () => {
      fake.workers++;
      if (fake.failWorker) throw new Error('worker failed');
      return { table: async () => ({}) };
    },
  },
}));
vi.mock('@perspective-dev/viewer', () => ({
  default: {
    init_client: () => new Promise<void>((resolve, reject) => fake.inits.push({ resolve, reject })),
  },
}));
vi.mock('@perspective-dev/viewer-datagrid', () => ({}));
vi.mock('@perspective-dev/viewer-charts', () => ({}));
vi.mock('@perspective-dev/viewer/dist/css/pro.css', () => ({}));
vi.mock('@perspective-dev/viewer/dist/css/pro-dark.css', () => ({}));
vi.mock('@perspective-dev/server/dist/wasm/perspective-server.wasm', () => ({ default: 'server.wasm' }));
vi.mock('@perspective-dev/server/dist/wasm/perspective-server.memory64.wasm', () => ({ default: 'server64.wasm' }));
vi.mock('@perspective-dev/viewer/dist/wasm/perspective-viewer.wasm', () => ({ default: 'viewer.wasm' }));

/** Lets the promises settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('fetch', async () => new Response());
  fake.inits = [];
  fake.workers = 0;
  fake.failWorker = false;
});

describe('explorePerspective', () => {
  it('starts the worker once the viewer’s wasm is in, one for the page', async () => {
    const { explorePerspective } = await import('./perspective');
    const first = explorePerspective.worker();
    const second = explorePerspective.worker();
    await settle();
    expect(fake.workers).toBe(0);
    fake.inits[0].resolve();
    expect(await first).toBe(await second);
    expect(fake.inits).toHaveLength(1);
    expect(fake.workers).toBe(1);
  });

  it('tries a failed load of the viewer’s wasm again on the next call', async () => {
    const { explorePerspective } = await import('./perspective');
    const failed = explorePerspective.worker();
    fake.inits[0].reject(new Error('network'));
    await expect(failed).rejects.toThrow('network');
    const again = explorePerspective.worker();
    fake.inits[1].resolve();
    await again;
    expect(fake.workers).toBe(1);
  });

  it('tries a failed worker again, the viewer’s wasm loaded once', async () => {
    const { explorePerspective } = await import('./perspective');
    fake.failWorker = true;
    const failed = explorePerspective.worker();
    fake.inits[0].resolve();
    await expect(failed).rejects.toThrow('worker failed');
    fake.failWorker = false;
    await explorePerspective.worker();
    expect(fake.inits).toHaveLength(1);
    expect(fake.workers).toBe(2);
  });
});
