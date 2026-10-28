import { Disposable } from '../core/disposable/disposable';
import { CommandsHost } from '../hosts/commands/commands';
import { ExtensionHost, StorageMemento, type Extension } from '../hosts/extension-host/extension-host';
import { WindowHost } from '../hosts/window/window';

/**
 * The workbench in `host`: its hosts (commands, window, extensions) and the extensions activated on them. The page's
 * `content` goes into the content region; bound keys work anywhere on the page. Lives as long as the page; `dispose` takes it all down (tests).
 */
export function createWorkbench(host: HTMLElement, options: { extensions: readonly Extension[]; content?: HTMLElement | null }): Disposable {
  const doc = host.ownerDocument;
  const commands = new CommandsHost(doc.documentElement);
  const window = new WindowHost(host, StorageMemento.of(doc, 'sessionStorage', 'dashica:workbench:'), commands);
  if (options.content) window.content.append(options.content);
  const extensions = new ExtensionHost({ commands, window, ownerDocument: doc });
  extensions.activate(options.extensions);
  return new Disposable(() => {
    extensions.dispose();
    window.dispose();
    commands.dispose();
  });
}
