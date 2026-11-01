// @vitest-environment jsdom
// Tests for Notifications: an error shown at the workbench's bottom right, announced, its text as given, until it is
// closed; several one below the other, the newest last; the column gone with the last one and on dispose.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Notifications } from './notifications';

let hostContainer: HTMLElement;
let notifications: Notifications;

beforeEach(() => {
  hostContainer = document.body.appendChild(document.createElement('div'));
  notifications = new Notifications(hostContainer);
});

afterEach(() => document.body.replaceChildren());

const shown = () => [...hostContainer.querySelectorAll<HTMLElement>('.d-workbench__notification')];
const close = (notificationElement: HTMLElement) => notificationElement.querySelector<HTMLButtonElement>('button[aria-label=Close]')!.click();

describe('Notifications', () => {
  it('shows an error, announced, until it is closed, and resolves then', async () => {
    let closed = false;
    const done = notifications.showError('Filter status = 500 failed: 422: "status" cannot filter').then(() => (closed = true));
    expect(shown().map((notificationElement) => [notificationElement.getAttribute('role'), notificationElement.classList.contains('d-workbench__notification--error'), notificationElement.textContent?.trim()])).toEqual([
      ['alert', true, 'Filter status = 500 failed: 422: "status" cannot filter'],
    ]);
    await Promise.resolve();
    expect(closed).toBe(false);
    close(shown()[0]!);
    await done;
    expect([closed, hostContainer.querySelector('.d-workbench__notifications')]).toEqual([true, null]);
  });

  it('shows several one below the other, the newest last, and keeps the others when one is closed', () => {
    void notifications.showError('first');
    void notifications.showError('second');
    expect(shown().map((notificationElement) => notificationElement.textContent?.trim())).toEqual(['first', 'second']);
    close(shown()[0]!);
    expect(shown().map((notificationElement) => notificationElement.textContent?.trim())).toEqual(['second']);
  });

  it('removes them all on dispose', () => {
    void notifications.showError('first');
    notifications.dispose();
    expect(hostContainer.querySelector('.d-workbench__notifications')).toBeNull();
  });
});
