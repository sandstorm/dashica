import {withRuntime} from "../util/runtime.js";
import {clickhouse} from "../../index.js";
import {sqlFilterInput} from "./sqlFilterInput.js";
import {globalTimeSelector} from "./index.js";

export function globalFilter() {
    return withRuntime(o => {
        const $clickhouseSchema = o.$cell([], () => clickhouse.schema());
        const $sqlFilter = o.$cell([$clickhouseSchema], (clickhouseSchema) => sqlFilterInput(clickhouseSchema));
        const $globalTimeSelector = o.$cell([], () => globalTimeSelector());

        const $currentFilterValues = o.$cell([
            o.$widgetValues($sqlFilter),
            o.$widgetValues($globalTimeSelector),
        ], (
            sqlFilterValues,
            globalTimeSelectorValues,
        ) => {
            return {
                sqlFilter: sqlFilterValues,
                from: globalTimeSelectorValues.from,
                to: globalTimeSelectorValues.to
            }
        });

        return o.renderWithWidgetValues($currentFilterValues)`<div class="globalFilter">
            ${$sqlFilter}
            
            ${$globalTimeSelector}
        </div>`;
    });
}