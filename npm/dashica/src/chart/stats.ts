import {html} from "htl";
import {decorateChart} from "../component/decorateChart.js";
import type {QueryResult} from "../types";
import {SchemaAnalyzer} from "../util/schema.js";

interface ChartProps {
    title?: string;
    fill?: string;
}
export interface Stat {
    label?: string;
    value: number;
    color?: string;
}

// TODO: fixed colors for different levels??
async function _stats(data: QueryResult, props: ChartProps): Promise<HTMLElement> {
    const schema = new SchemaAnalyzer(data);

    if (!props.title) {
        schema.requiredColumn('label');
    }

    schema.requiredColumn('value');
    const dataArr = data.toArray() as Stat[];

    return Promise.resolve(
        html`<dl class="stats">
            ${dataArr.map(renderStat(props))}
        </dl>`
    );
}
export const stats = decorateChart(_stats);

const renderStat = (props: ChartProps) => (stat: Stat): HTMLElement => {
    const color = stat.color ?? props.fill ?? 'oklch(0.21 0.034 264.665)';
    return html`<div class="stats__stat">
        <dt>${stat.label ?? props.title}</dt>
        <dd style=${{color}}>${Math.round(stat.value * 100) / 100}</dd>
    </div>`;
}
