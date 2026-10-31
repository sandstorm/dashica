// @vitest-environment jsdom
// Tests for checkbox-group.ts: the defaults, a click into the param, the param into the checkboxes.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { widgetTestbed } from '../../hosts/widgets/widgets-testing';
import type { WidgetNode } from '../../generated/zz_generated.dashica';
import { PARAMS, withParam } from '../widget-library/params-state';
import { checkboxGroup } from './checkbox-group';

let testbed: ReturnType<typeof widgetTestbed>;

beforeEach(() => {
  testbed = widgetTestbed();
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
    const { el } = testbed.render(methods);
    expect(param('methods')).toBe('["GET"]');
    expect(checkbox(el, 'GET').checked).toBe(true);
    expect(checkbox(el, 'POST').checked).toBe(false);
  });

  it('keeps the param the page has', () => {
    setParam('methods', '["POST"]');
    const { el } = testbed.render(methods);
    expect(param('methods')).toBe('["POST"]');
    expect(checkbox(el, 'POST').checked).toBe(true);
  });

  it('writes a click into the param', () => {
    const { el } = testbed.render(methods);
    checkbox(el, 'POST').click();
    expect(param('methods')).toBe('["GET","POST"]');
    checkbox(el, 'GET').click();
    expect(param('methods')).toBe('["POST"]');
  });

  it('shows a param set elsewhere (the back button)', () => {
    const { el } = testbed.render(methods);
    setParam('methods', '["POST"]');
    expect(checkbox(el, 'GET').checked).toBe(false);
    expect(checkbox(el, 'POST').checked).toBe(true);
  });
});
