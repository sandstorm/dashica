import { html } from 'htl';
import { Disposable } from '../../core/disposable/disposable';
import type { Extension } from '../../hosts/extension-host/extension-host';
import type { WidgetContext, WidgetOf } from '../../hosts/widgets/widgets';

/**
 * The widget type `textInput`: a text field whose text is the page's param `name` (`{path:String}` in a query). With
 * `prependCaret`, a text is stored with a leading `^`, so a typed path prefix (`/api/`) becomes a regex (`^/api/`); the
 * field shows it without.
 */
export const textInput: Extension = {
  id: 'textInput',
  activate: ({ widgets, subscriptions }) => subscriptions.push(widgets.registerWidget('textInput', renderTextInput)),
};

function renderTextInput(el: HTMLElement, widget: WidgetOf<'textInput'>, ctx: WidgetContext): Disposable {
  const name = widget.props.name ?? '';
  const params = ctx.state.params;
  // set before the charts query: ClickHouse refuses a query with {path:String} unset ("Substitution is not set")
  if (params.get(name) === undefined) params.set(name, '');

  const input: HTMLInputElement = html`<input
    type="text"
    class="input input-sm input-bordered w-full max-w-md font-mono"
    placeholder=${widget.props.placeholder ?? ''}>`;
  input.addEventListener('input', () => {
    const text = input.value;
    params.set(name, widget.props.prependCaret && text !== '' ? `^${text}` : text);
  });
  const showText = () => {
    const stored = params.get(name) ?? '';
    const text = widget.props.prependCaret && stored.startsWith('^') ? stored.substring(1) : stored;
    // while typing, the field has it already; setting it would move the cursor to the end
    if (input.value !== text) input.value = text;
  };
  showText();

  el.replaceChildren(html`<div class="form-control">
    <label class="label"><span class="label-text font-medium">${widget.props.label ?? ''}</span></label>
    ${input}
  </div>`);
  // the browser's back button, a shared link
  return params.onDidChange(showText);
}
