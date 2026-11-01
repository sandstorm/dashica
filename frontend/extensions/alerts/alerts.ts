import * as Plot from '@observablehq/plot';
import type { TimeBarProps } from '../../generated/zz_generated.dashica';
import type { Extension } from '../../hosts/extension-host/extension-host';
import type { QueryResult, WidgetContext, WidgetOf } from '../../hosts/widgets/widgets';
import { ChartFrame, type DrawOptions } from '../chart-library/chart-frame';
import { resolvedTimeRangeOf, timeAxisLabel } from '../chart-library/time-axis';
import { drawTimeBars } from '../chart-library/time-bars';
import { timeCursor } from '../chart-library/time-cursor';

/**
 * The widget types `alertOverview` and `alertDetail`: the status of the alerts of a group over time, one row per alert,
 * and the history of one alert's value with its thresholds (`thresholdsOf`, X-Dashica-Alert-If) as red lines
 * (`chart-library/time-bars.ts`), each in a chart frame.
 */
export const alerts: Extension = {
  id: 'alerts',
  activate({ widgets, subscriptions }) {
    subscriptions.push(widgets.registerWidget('alertOverview', renderAlertOverview));
    subscriptions.push(widgets.registerWidget('alertDetail', renderAlertDetail));
  },
};

/**
 * The thresholds of the alert whose history `result` is (X-Dashica-Alert-If: `{value_gt, value_lt}`), those set and
 * not 0, drawn as red lines; none without the header.
 */
export function thresholdsOf({ headers }: Pick<QueryResult, 'headers'>): number[] {
  const alertIf: { value_gt?: number | null; value_lt?: number | null } | null = JSON.parse(headers.get('X-Dashica-Alert-If') || 'null');
  return [alertIf?.value_gt, alertIf?.value_lt].filter((value): value is number => !!value);
}

function renderAlertOverview(widgetContainer: HTMLElement, _widget: WidgetOf<'alertOverview'>, ctx: WidgetContext): ChartFrame {
  return new ChartFrame(widgetContainer, ctx, {
    draw: (result, options) => drawAlertOverview(result, options),
  });
}

/** A row per alert (`alert_id_key`), a line per status from `start` to `end`: thin when OK, else thick, with a tooltip. */
function drawAlertOverview(data: QueryResult, options: DrawOptions) {
  const range = resolvedTimeRangeOf(data);
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
      label: timeAxisLabel('time', range),
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
      timeCursor(options.timeCursor),
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

function renderAlertDetail(widgetContainer: HTMLElement, widget: WidgetOf<'alertDetail'>, ctx: WidgetContext): ChartFrame {
  const history: TimeBarProps = {
    title: widget.props.title,
    height: 200,
    x: { kind: 'expr', alias: 'time', xBucketSizeMs: 15 * 60 * 1000 },
    y: { kind: 'expr', alias: 'value' },
  };
  return new ChartFrame(widgetContainer, ctx, {
    title: widget.props.title,
    height: 200,
    draw: (result, options) => drawTimeBars(result, history, options, { thresholds: thresholdsOf(result) }),
  });
}
