import { html } from 'htl';
import { Disposable } from '../../core/disposable/disposable';
import type { Extension } from '../../hosts/extension-host/extension-host';
import type { WidgetContext, WidgetOf } from '../../hosts/widgets/widgets';
import { paramsOf, withParam } from '../widget-library/params-state';

/**
 * The widget type `checkboxGroup`: a row of checkboxes, one per option, whose checked options are the page's param
 * `name` (`paramsOf`) as a JSON array (`["GET","POST"]`), for a query like
 * `countSubstrings({methods:String}, method) > 0`. A page opened without the param starts with the group's defaults.
 */
export const checkboxGroup: Extension = {
  id: 'checkboxGroup',
  activate: ({ widgets, subscriptions }) => subscriptions.push(widgets.registerWidget('checkboxGroup', renderCheckboxGroup)),
};

function renderCheckboxGroup(el: HTMLElement, widget: WidgetOf<'checkboxGroup'>, ctx: WidgetContext): Disposable {
  const name = widget.props.name ?? '';
  const params = paramsOf(ctx.state);
  const set = (value: string) => params.set(withParam(params.get(), name, value));
  // set before the charts query, so they see the defaults
  if (params.get()[name] === undefined) set(JSON.stringify(widget.props.defaults ?? []));

  const checkboxes = (widget.props.options ?? []).map((option) => {
    const checkbox: HTMLInputElement = html`<input type="checkbox" class="d-checkbox">`;
    checkbox.addEventListener('change', () => {
      const checked = checkedOptions(params.get()[name]).filter((o) => o !== option);
      if (checkbox.checked) checked.push(option);
      set(JSON.stringify(checked));
    });
    return { option, checkbox };
  });
  const showChecked = () => {
    const checked = checkedOptions(params.get()[name]);
    for (const { option, checkbox } of checkboxes) checkbox.checked = checked.includes(option);
  };
  showChecked();

  el.replaceChildren(html`<div class="d-form-field">
    <span class="d-form-field__label">${widget.props.label ?? ''}</span>
    <div class="d-form-field__options">
      ${checkboxes.map(({ option, checkbox }) => html`<label class="d-form-field__option">
        ${checkbox}
        <span>${option}</span>
      </label>`)}
    </div>
  </div>`);
  // the browser's back button, a shared link
  return params.onDidChange(showChecked);
}

/** The options of the param's JSON array; anything else is none. */
function checkedOptions(param: string | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(param ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((o): o is string => typeof o === 'string') : [];
  } catch {
    return [];
  }
}
