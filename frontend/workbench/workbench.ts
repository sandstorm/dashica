import { Disposable } from '../core/disposable/disposable';
import { CommandsHost } from '../hosts/commands/commands';
import { ExtensionHost, StorageMemento, type Extension } from '../hosts/extension-host/extension-host';
import { UiHost } from '../hosts/ui/ui';

/**
 * The workbench in `host`: its hosts (commands, ui, extensions) and the extensions activated on them. The page's
 * `content` goes into the content region; bound keys work anywhere on the page. Lives as long as the page; `dispose` takes it all down (tests).
 */
export function createWorkbench(host: HTMLElement, options: { extensions: readonly Extension[]; content?: HTMLElement | null }): Disposable {
  const doc = host.ownerDocument;
  const commands = new CommandsHost(doc.documentElement);
  const ui = new UiHost(host, StorageMemento.of(doc, 'sessionStorage', 'dashica:workbench:'), commands);
  if (options.content) ui.content.append(options.content);
  const extensions = new ExtensionHost({ commands, ui, ownerDocument: doc });
  extensions.activate(options.extensions);
  return new Disposable(() => {
    extensions.dispose();
    ui.dispose();
    commands.dispose();
  });
}
