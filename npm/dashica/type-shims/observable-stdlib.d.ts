declare module "observablehq:stdlib" {

    /**
     * Observer callback function that receives values from an observable.
     * @template T The type of value being observed
     */
    type ObserverCallback<T> = (value: T) => T;

    /**
     * Disposal function returned by initializers to clean up resources.
     */
    type DisposeFunction = () => void;

    /**
     * Initializer function that sets up observation and returns an optional disposal function.
     * @template T The type of value being observed
     */
    type InitializeFunction<T> = (notifyObservers: ObserverCallback<T>) => void | DisposeFunction;


    export namespace Generators {
        function input<T>(value: T): Generator<T>;

        function observe<T>(initialize: InitializeFunction<T>): AsyncGenerator<T, void, unknown>;

        function dark(): any;

    }

    export function resize(cb: (width: number) => Promise<SVGSVGElement | HTMLElement>);
    export function FileAttachment(path: string): FileAttachmentResult;

    export interface FileAttachmentResult {
        json(opts: {typed: boolean});
    }

    export interface Generator<T> {
        /**
         * The current value of the generator
         */
        value: T;

        /**
         * The DOM element associated with this generator
         */
        element: HTMLElement;

        /**
         * Invalidates the current value, causing a recomputation
         */
        invalidate(): void;
    }
}
