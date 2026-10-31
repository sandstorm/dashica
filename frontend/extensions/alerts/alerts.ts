import * as Plot from '@observablehq/plot';
import type { TimeBarProps } from '../../generated/zz_generated.dashica';
import type { Extension } from '../../hosts/extension-host/extension-host';
import type { QueryResult, WidgetContext, WidgetOf } from '../../hosts/widgets/widgets';
import { ChartFrame, type DrawOptions } from '../chart-library/chart-frame';
import { drawTimeBars } from '../chart-library/time-bars';

/**
 * The widget types `alertOverview` and `alertDetail`: the status of the alerts of a group over time, one row per alert,
 * and the history of one alert's value with its thresholds as red lines (`chart-library/time-bars.ts`), each in a
 * chart frame.
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

/** A row per alert (`alert_id_key`), a line per status from `start` to `end`: thin when OK, else thick, with a tooltip. */
function drawAlertOverview(data: QueryResult, options: DrawOptions) {
  const range = data.dashicaResolvedTimeRange;
  return Plot.plot({
    width: options.width,
    marginLeft: 130,
    color: {
      legend: false,
      domain: ['OK', 'warn', 'error'],
      range: ['#56AF18', '#F8C666', '#DB5757'],
      unknown: '#8E44AD',
    },
    x: {
      axis: 'top',
      type: 'time',
      clamp: true,
      domain: range ? [range.from, range.to] : undefined,
      grid: false,
    },
    y: {
      label: null,
      axis: null,
    },
    marks: [
      Plot.axisY({ label: null, tickSize: 0 }),
      Plot.ruleY(data, {
        x1: 'start',
        x2: 'end',
        y: 'alert_id_key',
        stroke: 'status',
        strokeWidth: (d: Record<string, unknown>) => (d['status'] == 'OK' ? 3 : 10),
      }),
      Plot.tip(
        data.toArray().filter((d: Record<string, unknown>) => d['status'] !== 'OK'),
        Plot.pointerY({
          x1: 'start',
          x2: 'end',
          y: 'alert_id_key',
          stroke: 'status',
          format: {
            x1: (d: Date) => hoursMinutes(d),
            x2: (d: Date) => hoursMinutes(d),
            y: false,
          },
        }),
      ),
    ],
  });
}

function hoursMinutes(time: Date) {
  return time.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function renderAlertDetail(el: HTMLElement, widget: WidgetOf<'alertDetail'>, ctx: WidgetContext): ChartFrame {
  // the alert's history: its columns `time` and `value`, as 15 minute bars
  const history: TimeBarProps = {
    title: widget.props.title,
    height: 200,
    x: { kind: 'expr', alias: 'time', xBucketSizeMs: 15 * 60 * 1000 },
    y: { kind: 'expr', alias: 'value' },
  };
  return new ChartFrame(el, ctx, {
    title: widget.props.title,
    height: 200,
    draw: (result, options) => drawTimeBars(result, history, options),
  });
}
