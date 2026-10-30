import { Disposable } from '../core/disposable/disposable';
import type { WorkbenchJson } from '../generated/zz_generated.dashica';
import { CommandsHost } from '../hosts/commands/commands';
import { ExtensionHost, StorageMemento, type Extension } from '../hosts/extension-host/extension-host';
import { PageHost } from '../hosts/page/page';
import { QueryHost } from '../hosts/query/query';
import { UiHost } from '../hosts/ui/ui';
import { WidgetsHost } from '../hosts/widgets/widgets';

/**
 * The workbench in `host`: its hosts (commands, ui, page, query, widgets, extensions) and the extensions activated on
 * them, then the page of the URL in the content region. `workbench` is what `/workbench.json` says. Bound keys work
 * anywhere on the page. Lives as long as the page; `dispose` takes it all down (tests).
 */
export function createWorkbench(host: HTMLElement, options: { extensions: readonly Extension[]; workbench: WorkbenchJson }): Disposable {
  const doc = host.ownerDocument;
  const commands = new CommandsHost(doc.documentElement);
  const ui = new UiHost(host, StorageMemento.of(doc, 'sessionStorage', 'dashica:workbench:'), commands);
  const query = new QueryHost(doc.defaultView!);
  const page = new PageHost(doc.defaultView!, options.workbench, query, ui.content);
  const widgets = new WidgetsHost(query, ui, commands);
  const extensions = new ExtensionHost({ commands, ui, page, query, widgets, ownerDocument: doc });
  extensions.activate(options.extensions);
  void page.start();
  return new Disposable(() => {
    page.dispose();
    extensions.dispose();
    widgets.dispose();
    query.dispose();
    ui.dispose();
    commands.dispose();
  });
}
