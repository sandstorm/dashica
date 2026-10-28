/** A `<div>` of `doc` with `className`: what the workbench's regions and panels are built from. */
export function div(doc: Document, className: string): HTMLElement {
  const element = doc.createElement('div');
  element.className = className;
  return element;
}
