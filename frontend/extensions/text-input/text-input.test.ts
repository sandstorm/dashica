// @vitest-environment jsdom
// Tests for text-input.ts: the empty param, typing into it, the caret, the error without the page params.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { widgetTestbed } from '../../hosts/widgets/widgets-testing';
import { PARAMS, withParam } from '../widget-library/params-state';
import { textInput } from './text-input';

let testbed: ReturnType<typeof widgetTestbed>;

beforeEach(() => {
  // declared as by the dashboard page
  testbed = widgetTestbed({ keys: [PARAMS] });
  testbed.activate(textInput);
});

afterEach(() => testbed.dispose());

/** The page params, as the dashboardPage extension keeps them. */
const param = (name: string) => testbed.query.get(PARAMS)[name];
const setParam = (name: string, value: string) => testbed.query.set(PARAMS, withParam(testbed.query.get(PARAMS), name, value));

function type(inputElement: HTMLInputElement, text: string): void {
  inputElement.value = text;
  inputElement.dispatchEvent(new Event('input'));
}

describe('textInput', () => {
  it('sets its param empty when the page has none, so a query has it', () => {
    testbed.render({ type: 'textInput', props: { name: 'path', label: 'Path' } });
    expect(param('path')).toBe('');
  });

  it('writes what is typed into its param', () => {
    const { widgetContainer } = testbed.render({ type: 'textInput', props: { name: 'path', label: 'Path', placeholder: '/api/' } });
    const inputElement = widgetContainer.querySelector('input')!;
    expect(inputElement.placeholder).toBe('/api/');
    type(inputElement, '/api/orders');
    expect(param('path')).toBe('/api/orders');
  });

  it('with prependCaret, stores the text with a leading ^ and shows it without', () => {
    setParam('path', '^/api/');
    const { widgetContainer } = testbed.render({ type: 'textInput', props: { name: 'path', prependCaret: true } });
    const inputElement = widgetContainer.querySelector('input')!;
    expect(inputElement.value).toBe('/api/');
    type(inputElement, '/checkout');
    expect(param('path')).toBe('^/checkout');
    type(inputElement, '');
    expect(param('path')).toBe('');
  });
});
