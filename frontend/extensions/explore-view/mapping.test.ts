// Tests for initialView in mapping.ts: each widget type's config on its result, the rows of an edited query, the notes.
import { describe, expect, it } from 'vitest';
import type { SqlFieldProps, WidgetNode } from '../../generated/zz_generated.dashica';
import { initialView, type RowsShape } from './mapping';

const time: SqlFieldProps = { kind: 'autoBucket', alias: 'time' };
const count: SqlFieldProps = { kind: 'count', alias: 'requests' };
const status: SqlFieldProps = { kind: 'expr', alias: 'status' };
const host: SqlFieldProps = { kind: 'expr', alias: 'host' };

const result = (columns: string[]): RowsShape => ({ kind: 'result', columns });
const chart = (widget: Omit<Extract<WidgetNode, { dataUrl: string }>, 'dataUrl'>) => ({ ...widget, dataUrl: '/p/shop/api/3' }) as WidgetNode;

describe('initialView', () => {
  it('rebuilds a time bar on its result: grouped by its time column, the fill split, the count summed', () => {
    const view = initialView(chart({ type: 'timeBar', props: { x: time, y: count, fill: status } }), result(['time', 'status', 'requests']));
    expect(view.config).toEqual({
      plugin: 'Y Bar',
      group_by: ['time'],
      split_by: ['status'],
      columns: ['requests'],
      aggregates: { requests: 'sum' },
      expressions: {},
      filter: [],
      sort: [],
    });
    expect(view.notes).toEqual([]);
  });

  it('takes fx and fy of a bar chart as further group levels', () => {
    const view = initialView(chart({ type: 'barVertical', props: { x: status, y: count, fx: host } }), result(['status', 'host', 'requests']));
    expect(view.config).toMatchObject({ plugin: 'Y Bar', group_by: ['status', 'host'] });
  });

  it('takes a measure computed in SQL as its last value, one row per group', () => {
    const view = initialView(chart({ type: 'timeLine', props: { x: time, y: { kind: 'expr', alias: 'p95_ms' }, strokeField: host } }), result(['time', 'host', 'p95_ms']));
    expect(view.config).toMatchObject({ plugin: 'Y Line', group_by: ['time'], split_by: ['host'], columns: ['p95_ms'], aggregates: { p95_ms: 'last' } });
  });

  it('splits a time line by its z field when it has no stroke field', () => {
    const view = initialView(chart({ type: 'timeLine', props: { x: time, y: count, zField: host } }), result(['time', 'host', 'requests']));
    expect(view.config.split_by).toEqual(['host']);
  });

  it('leaves out a dimension the result lacks, with a note', () => {
    const view = initialView(chart({ type: 'barVertical', props: { x: host, y: count, fill: { kind: 'expr', alias: 'customer_project' } } }), result(['host', 'requests']));
    expect(view.config).toMatchObject({ group_by: ['host'], split_by: [], columns: ['requests'] });
    expect(view.notes).toEqual(['`fill` (`customer_project`) is not a column of the chart’s result']);
  });

  it('groups a horizontal bar chart by its y, its x the measure', () => {
    const view = initialView(chart({ type: 'barHorizontal', props: { x: count, y: host, fill: status } }), result(['host', 'status', 'requests']));
    expect(view.config).toMatchObject({ plugin: 'X Bar', group_by: ['host'], split_by: ['status'], columns: ['requests'] });
  });

  it('splits a heatmap by its y, its fill the measure', () => {
    const view = initialView(chart({ type: 'timeHeatmap', props: { x: time, y: { kind: 'expr', alias: 'duration_ms' }, fill: count, yBucketSize: 100 } }), result(['time', 'duration_ms', 'requests']));
    expect(view.config).toMatchObject({ plugin: 'Heatmap', group_by: ['time'], split_by: ['duration_ms'], columns: ['requests'], aggregates: { requests: 'sum' } });
  });

  it('shows stats as a grid grouped by their title field, and a table as a grid of all its columns', () => {
    expect(initialView(chart({ type: 'stats', props: { titleField: host } }), result(['host', 'value'])).config).toMatchObject({ plugin: 'Datagrid', group_by: ['host'], columns: ['host', 'value'], aggregates: {} });
    expect(initialView(chart({ type: 'table', props: {} }), result(['timestamp', 'message'])).config).toMatchObject({ plugin: 'Datagrid', group_by: [], columns: ['timestamp', 'message'] });
  });

  it('shows the rows of an edited query as a grid of all their columns when they lack a column of the chart', () => {
    const view = initialView(chart({ type: 'timeBar', props: { x: time, y: count, fill: status } }), { kind: 'edited', columns: ['timestamp', 'status', 'host'] });
    expect(view.config).toMatchObject({ plugin: 'Datagrid', group_by: [], split_by: [], columns: ['timestamp', 'status', 'host'], aggregates: {} });
    expect(view.notes).toEqual([]);
  });

  it('rebuilds the chart on the rows of an edited query that have its columns', () => {
    const view = initialView(chart({ type: 'timeBar', props: { x: time, y: count, fill: status } }), { kind: 'edited', columns: [time.alias, status.alias, count.alias, 'host'] });
    expect(view.config).toMatchObject({ plugin: 'Y Bar', group_by: [time.alias], split_by: [status.alias], columns: [count.alias] });
  });
});
