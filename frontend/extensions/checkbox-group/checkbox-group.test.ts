// @vitest-environment jsdom
// Tests for checkbox-group.ts: the defaults, a click into the param, the param into the checkboxes.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { widgetTestbed } from '../../hosts/widgets/widgets-testing';
import type { WidgetNode } from '../../generated/zz_generated.dashica';
import { PARAMS, withParam } from '../widget-library/params-state';
import { checkboxGroup } from './checkbox-group';

let testbed: ReturnType<typeof widgetTestbed>;

beforeEach(() => {
  // declared as by the dashboard page
  testbed = widgetTestbed({ keys: [PARAMS] });
  testbed.activate(checkboxGroup);
});

afterEach(() => testbed.dispose());

/** The page params, as the dashboardPage extension keeps them. */
const param = (name: string) => testbed.query.get(PARAMS)[name];
const setParam = (name: string, value: string) => testbed.query.set(PARAMS, withParam(testbed.query.get(PARAMS), name, value));

const methods: WidgetNode = {
  type: 'checkboxGroup',
  props: {
    name: 'methods',
    label: 'Methods',
    options: ['GET', 'POST'],
    defaults: ['GET'],
  },
};

function checkbox(el: HTMLElement, option: string): HTMLInputElement {
  const label = [...el.querySelectorAll('label.d-form-field__option')].find((l) => l.textContent!.includes(option))!;
  return label.querySelector('input')!;
}

describe('checkboxGroup', () => {
  it('sets its defaults when the page has no param yet', () => {
    const { widgetContainer } = testbed.render(methods);
    expect(param('methods')).toBe('["GET"]');
    expect(checkbox(widgetContainer, 'GET').checked).toBe(true);
    expect(checkbox(widgetContainer, 'POST').checked).toBe(false);
  });

  it('keeps the param the page has', () => {
    setParam('methods', '["POST"]');
    const { widgetContainer } = testbed.render(methods);
    expect(param('methods')).toBe('["POST"]');
    expect(checkbox(widgetContainer, 'POST').checked).toBe(true);
  });

  it('writes a click into the param', () => {
    const { widgetContainer } = testbed.render(methods);
    checkbox(widgetContainer, 'POST').click();
    expect(param('methods')).toBe('["GET","POST"]');
    checkbox(widgetContainer, 'GET').click();
    expect(param('methods')).toBe('["POST"]');
  });

  it('shows a param set elsewhere (the back button)', () => {
    const { widgetContainer } = testbed.render(methods);
    setParam('methods', '["POST"]');
    expect(checkbox(widgetContainer, 'GET').checked).toBe(false);
    expect(checkbox(widgetContainer, 'POST').checked).toBe(true);
  });
});
