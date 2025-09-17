import {resize} from "observablehq:stdlib";
import type {QueryResult, ChartComponent} from "../types";
import {html} from "htl";
import {modal} from "./modal.js";
import * as Inputs from "@observablehq/inputs";

type DecoratedFn<TProps> = (result: QueryResult, props: TProps & {invalidation?: Promise<void>}) => HTMLElement;

/**
 * Wraps a chart to make it responsive to fill the available horizontal space,
 * and adds common controls we have for every chart, such as:
 * - inspector table
 * - full query display
 * @param chartComponent
 */
export function decorateChart<TProps>(chartComponent: ChartComponent<TProps>): DecoratedFn<TProps> {
    return (result: QueryResult, props: TProps & {invalidation?: Promise<void>}): HTMLElement => {
        return resize(async (width) => {
            let renderedChart = null;
            try {
                renderedChart = await chartComponent(result, Object.assign({}, props, {width}) as TProps);
            } catch (e) {
                renderedChart = html`ERROR during rendering: ${String(e)}`;
            }

            const tableDetails = modal(html`<iconify-icon icon="material-symbols:table-chart-outline-sharp" width="24" height="24" />`, Inputs.table(result));
            const domNode = html`
                <div class="decoratedChart">
                    <div class="decoratedChart__floatingMenu">${tableDetails}</div>
                    ${renderedChart}
                </div>
            `

            if (props.invalidation?.then) {
                props.invalidation.then(() => domNode.classList.add("decoratedChart--isRerendering"));
            }

            return domNode;
        });
    }
}
