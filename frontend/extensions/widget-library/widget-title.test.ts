// Tests for widget-title.ts: a widget's title, else its type.
import { describe, expect, it } from 'vitest';
import type { WidgetNode } from '../../generated/zz_generated.dashica';
import { widgetTitle } from './widget-title';

const timeBar = (title?: string): WidgetNode => ({ type: 'timeBar', props: { title, x: { kind: 'expr', alias: 'time' }, y: { kind: 'count', alias: 'cnt' } }, dataUrl: '/p/shop/api/1' });

describe('widgetTitle', () => {
  it('is the widget’s title, else its type', () => {
    expect(widgetTitle(timeBar('Requests'))).toBe('Requests');
    expect(widgetTitle(timeBar())).toBe('timeBar');
    expect(widgetTitle(timeBar(''))).toBe('timeBar');
  });
});
