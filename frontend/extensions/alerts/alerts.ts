import { alertOverview as drawAlertOverview } from '../../chart/alertOverview';
import { timeBar as drawTimeBar } from '../../chart/timeBar';
import type { Extension } from '../../hosts/extension-host/extension-host';
import { ChartFrame, type WidgetContext, type WidgetOf } from '../../hosts/widgets/widgets';

/**
 * The widget types `alertOverview` and `alertDetail`: the status of the alerts of a group over time, one row per alert
 * (`frontend/chart/alertOverview.ts`), and the history of one alert's value with its thresholds as red lines
 * (`frontend/chart/timeBar.ts`), each in a chart frame.
 */
export const alerts: Extension = {
  id: 'alerts',
  activate({ widgets, subscriptions }) {
    subscriptions.push(widgets.registerWidget('alertOverview', renderAlertOverview));
    subscriptions.push(widgets.registerWidget('alertDetail', renderAlertDetail));
  },
};

function renderAlertOverview(el: HTMLElement, _widget: WidgetOf<'alertOverview'>, ctx: WidgetContext): ChartFrame {
  return new ChartFrame(el, ctx, {
    draw: (result, options) => drawAlertOverview(result, options),
  });
}

function renderAlertDetail(el: HTMLElement, widget: WidgetOf<'alertDetail'>, ctx: WidgetContext): ChartFrame {
  // the alert's history: its columns `time` and `value`, drawn as 15 minute bars
  const chartProps = { title: widget.props.title, height: 200, x: 'time', xBucketSize: 15 * 60 * 1000, y: 'value', extraMarks: [] };
  return new ChartFrame(el, ctx, {
    title: widget.props.title,
    height: 200,
    draw: (result, options) => drawTimeBar(result, { ...chartProps, ...options }),
  });
}
