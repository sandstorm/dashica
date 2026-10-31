import type { WidgetNode } from '../../generated/zz_generated.dashica';

/** A widget's title (`props.title`), else its type (`timeBar`): what Debug, Details and Explore call it. */
export function widgetTitle(widget: WidgetNode): string {
  return 'title' in widget.props && widget.props.title ? widget.props.title : widget.type;
}
