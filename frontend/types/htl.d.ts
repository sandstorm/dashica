// Types for htl (Hypertext Literal), which ships none.
declare module 'htl' {
  /**
   * The element the markup describes. Interpolated values are escaped by where they stand; a function as an attribute
   * value is set as a property (`onclick=${…}`), false or null leaves the attribute out, a node is inserted as it is.
   * `T`: the element's type, which the caller states, e.g. `html<HTMLButtonElement>`.
   */
  export const html: {
    <T extends Element = HTMLElement>(strings: TemplateStringsArray, ...values: unknown[]): T;
    fragment(strings: TemplateStringsArray, ...values: unknown[]): DocumentFragment;
  };
  export const svg: {
    <T extends Element = SVGElement>(strings: TemplateStringsArray, ...values: unknown[]): T;
    fragment(strings: TemplateStringsArray, ...values: unknown[]): DocumentFragment;
  };
}
