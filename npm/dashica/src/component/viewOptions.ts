import * as Inputs from "@observablehq/inputs";

export function viewOptions() {
    // NOTE: if adding new values here, add them to types.ts type ViewOption
    return Inputs.checkbox(new Map([["Log Scale", "VIEW_LOGARITHMIC"]]), {label: "View Options"});
}