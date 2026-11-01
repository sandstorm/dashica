import { html } from 'htl';
import { CircleX, X, createElement } from 'lucide';
import './notifications.css';

/**
 * What `showErrorMessage` shows: notifications in a column at the workbench `host`'s bottom right, the newest last,
 * each with its text and a close button; an error stays until the viewer closes it (as VS Code's), and is announced
 * (`role="alert"`) when it shows.
 */
export class Notifications {
  #column: HTMLElement | undefined;

  constructor(private readonly host: HTMLElement) {}

  /** Shows `message` as an error until it is closed; resolves then. */
  showError(message: string): Promise<void> {
    return new Promise((resolve) => {
      const close = () => {
        notification.remove();
        if (this.#column?.childElementCount === 0) this.#close();
        resolve();
      };
      const notification = html`<div class="d-workbench__notification d-workbench__notification--error" role="alert">
        ${createElement(CircleX, { width: 16, height: 16, class: 'd-workbench__notification-icon', 'aria-hidden': 'true' })}
        <span class="d-workbench__notification-message">${message}</span>
        <button type="button" class="d-workbench__notification-close" title="Close" aria-label="Close" onclick=${close}>${createElement(X, { width: 14, height: 14 })}</button>
      </div>`;
      this.#open().append(notification);
    });
  }

  dispose(): void {
    this.#close();
  }

  #open(): HTMLElement {
    this.#column ??= this.host.appendChild(html<HTMLElement>`<div class="d-workbench__notifications"></div>`);
    return this.#column;
  }

  #close(): void {
    this.#column?.remove();
    this.#column = undefined;
  }
}
