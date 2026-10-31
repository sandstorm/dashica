import { html } from 'htl';
import { Disposable } from '../../core/disposable/disposable';
import type { Extension } from '../../hosts/extension-host/extension-host';
import type { WidgetContext, WidgetOf } from '../../hosts/widgets/widgets';
import { PARAMS, withParam } from '../widget-library/params-state';

/**
 * The widget type `textInput`: a text field whose text is the page's param `name` (`{path:String}` in a query; the
 * query key `PARAMS`). With `prependCaret`, a text is stored with a leading `^`, so a typed path prefix
 * (`/api/`) becomes a regex (`^/api/`); the field shows it without.
 */
export const textInput: Extension = {
  id: 'textInput',
  activate: ({ widgets, subscriptions }) => subscriptions.push(widgets.registerWidget('textInput', renderTextInput)),
};

function renderTextInput(el: HTMLElement, widget: WidgetOf<'textInput'>, ctx: WidgetContext): Disposable {
  const name = widget.props.name ?? '';
  const { query } = ctx;
  const set = (value: string) => query.set(PARAMS, withParam(query.get(PARAMS), name, value));
  // set before the charts query: ClickHouse refuses a query with {path:String} unset ("Substitution is not set")
  if (query.get(PARAMS)[name] === undefined) set('');

  const input: HTMLInputElement = html`<input
    type="text"
    class="d-field d-field--full d-field--mono"
    placeholder=${widget.props.placeholder ?? ''}>`;
  input.addEventListener('input', () => {
    const text = input.value;
    set(widget.props.prependCaret && text !== '' ? `^${text}` : text);
  });
  const showText = () => {
    const stored = query.get(PARAMS)[name] ?? '';
    const text = widget.props.prependCaret && stored.startsWith('^') ? stored.substring(1) : stored;
    // while typing, the field has it already; setting it would move the cursor to the end
    if (input.value !== text) input.value = text;
  };
  showText();

  el.replaceChildren(html`<label class="d-form-field">
    <span class="d-form-field__label">${widget.props.label ?? ''}</span>
    ${input}
  </label>`);
  // the browser's back button, a shared link
  return query.onDidChange(PARAMS, showText);
}
