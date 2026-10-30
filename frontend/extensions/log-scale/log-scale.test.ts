// @vitest-environment jsdom
// Tests for log-scale.ts and title-bar-menu.ts in the workbench: the "⋮" menu shows the log scale, checked while on.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Disposable } from '../../core/disposable/disposable';
import { settle } from '../../hosts/widgets/widgets-testing';
import { createWorkbench } from '../../workbench/workbench';
import { dashboardPage } from '../dashboard-page/dashboard-page';
import { titleBarMenu } from '../title-bar-menu/title-bar-menu';
import { logScale } from './log-scale';

let workbench: Disposable;
let host: HTMLElement;

beforeEach(async () => {
  history.replaceState(null, '', '/p/shop');
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ kind: 'dashboard', title: 'Shop', filterBar: false, filterButtons: [], widgets: [] })));
  host = document.body.appendChild(document.createElement('div'));
  workbench = createWorkbench(host, { extensions: [titleBarMenu, logScale, dashboardPage], workbench: { menu: [] } });
  await settle();
});

afterEach(() => {
  workbench.dispose();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  sessionStorage.clear();
  history.replaceState(null, '', '/');
});

const more = () => host.querySelector<HTMLButtonElement>('button[aria-label=More]')!;
const entry = () => [...document.querySelectorAll<HTMLElement>('[role=menuitemcheckbox]')].find((item) => item.textContent?.includes('Log scale'))!;

describe('logScale', () => {
  it('turns the log scale on and off from the title bar’s menu, checked while on', async () => {
    more().click();
    expect(entry().getAttribute('aria-checked')).toBe('false');
    entry().click();
    await settle();
    more().click();
    expect(entry().getAttribute('aria-checked')).toBe('true');
  });
});
