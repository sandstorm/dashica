import { html } from 'htl';
import { CircleX, X, createElement } from 'lucide';
import './notifications.css';

/**
 * What `showErrorMessage` shows: notifications in a column at the workbench `hostContainer`'s bottom right, the newest
 * last, each with its text and a close button; an error stays until the viewer closes it (as VS Code's), and is
 * announced (`role="alert"`) when it shows.
 */
export class Notifications {
  #columnContainer: HTMLElement | undefined;

  constructor(private readonly hostContainer: HTMLElement) {}

  /** Shows `message` as an error until it is closed; resolves then. */
  showError(message: string): Promise<void> {
    return new Promise((resolve) => {
      const close = () => {
        notificationElement.remove();
        if (this.#columnContainer?.childElementCount === 0) this.#close();
        resolve();
      };
      const notificationElement = html`<div class="d-workbench__notification d-workbench__notification--error" role="alert">
        ${createElement(CircleX, { width: 16, height: 16, class: 'd-workbench__notification-icon', 'aria-hidden': 'true' })}
        <span class="d-workbench__notification-message">${message}</span>
        <button type="button" class="d-workbench__notification-close" title="Close" aria-label="Close" onclick=${close}>${createElement(X, { width: 14, height: 14 })}</button>
      </div>`;
      this.#open().append(notificationElement);
    });
  }

  dispose(): void {
    this.#close();
  }

  #open(): HTMLElement {
    this.#columnContainer ??= this.hostContainer.appendChild(html<HTMLElement>`<div class="d-workbench__notifications"></div>`);
    return this.#columnContainer;
  }

  #close(): void {
    this.#columnContainer?.remove();
    this.#columnContainer = undefined;
  }
}
