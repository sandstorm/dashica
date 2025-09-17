// Type definitions for Hypertext Literal (HTL)
// Project: https://github.com/observablehq/htl
// Definitions by: Claude

/**
 * Represents any DOM node (Element, Text, DocumentFragment, etc.)
 */
type DOMNode = Node;

/**
 * Represents a value that can be interpolated into HTL templates
 */
type Interpolable =
    | string
    | number
    | boolean
    | null
    | undefined
    | DOMNode
    | Iterable<any>
    | Record<string, any>
    | Function;

/**
 * Style object for the style attribute
 */
interface StyleObject {
    [key: string]: string | number | null | undefined;
}

/**
 * Event handler functions
 */
interface EventHandlers {
    [key: `on${string}`]: Function;
}

/**
 * Attributes that can be spread into an element
 */
interface SpreadAttributes extends EventHandlers {
    style?: StyleObject;
    [key: string]: any;
}

/**
 * The core hypertext template literal tag function
 */
interface HTMLTagFunction {
    /**
     * Creates an Element, Text node, or null based on the provided template.
     * - Returns an Element if the template contains a single top-level element
     * - Returns a Text node if the template contains only text
     * - Returns null if the template is empty
     * - Returns a SPAN element if the template contains multiple top-level nodes
     *
     * @param strings Template string literals
     * @param ...values Values to interpolate into the template
     * @returns An Element, Text node, or null
     */
    (strings: TemplateStringsArray, ...values: Interpolable[]): HTMLElement;

    /**
     * Creates a DocumentFragment containing the nodes from the provided template.
     * This is useful when composing multiple fragments together.
     *
     * @param strings Template string literals
     * @param ...values Values to interpolate into the template
     * @returns A DocumentFragment
     */
    fragment(strings: TemplateStringsArray, ...values: Interpolable[]): DocumentFragment;
}

/**
 * The SVG template literal tag function
 */
interface SVGTagFunction {
    /**
     * Creates an SVG Element, Text node, or null based on the provided template.
     * Similar to html`` but creates nodes in the SVG namespace.
     *
     * @param strings Template string literals
     * @param ...values Values to interpolate into the template
     * @returns An SVG Element, Text node, or null
     */
    (strings: TemplateStringsArray, ...values: Interpolable[]): SVGElement | Text | null;

    /**
     * Creates a DocumentFragment containing SVG nodes from the provided template.
     *
     * @param strings Template string literals
     * @param ...values Values to interpolate into the template
     * @returns A DocumentFragment with SVG nodes
     */
    fragment(strings: TemplateStringsArray, ...values: Interpolable[]): DocumentFragment;
}


/**
 * Hypertext Literal module
 */
declare module "htl" {
    /**
     * HTML template literal tag function
     */
    export const html: HTMLTagFunction;

    /**
     * SVG template literal tag function
     */
    export const svg: SVGTagFunction;
}