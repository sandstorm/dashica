import type { Extension } from '../../hosts/extension-host/extension-host';
import type { WidgetMenuContext } from '../../hosts/widgets/widgets';

/**
 * "Copy link to chart" in a chart's menu (`widget/context`): copies the link to the chart on the page shown
 * (`https://dashica.example/p/shop#w=3`, the id in its `dataUrl`), which opens the page at the chart. Only for widgets
 * with data.
 */
export const chartLink: Extension = {
  id: 'chartLink',
  activate({ ui, page, commands, subscriptions }) {
    subscriptions.push(
      commands.registerCommand('chartLink.copy', (widget: WidgetMenuContext) => navigator.clipboard.writeText(chartUrl(widget, page.activeTab.url))),
    );
    subscriptions.push(
      ui.registerMenuItem<WidgetMenuContext>('widget/context', {
        command: 'chartLink.copy',
        title: 'Copy link to chart',
        group: 'navigation',
        when: ({ widget }) => 'dataUrl' in widget && !!widget.dataUrl,
      }),
    );
  },
};

/** The absolute link to `widget` on the page at `shown` (the active tab's URL). */
function chartUrl({ widget }: WidgetMenuContext, shown: string): string {
  const id = 'dataUrl' in widget ? widget.dataUrl.split('/').pop()! : '';
  return `${location.origin}${new URL(shown, location.origin).pathname}#w=${encodeURIComponent(id)}`;
}
